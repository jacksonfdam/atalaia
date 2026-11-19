import logger from '../logger.js';
// Aliased: this module exports its own `query`, the filtered read the API uses.
import { query as runSql, queryAll, queryOne } from '../db/pool.js';
import { runMigrations } from '../db/migrationRunner.js';

/**
 * Vulnerability persistence, on Postgres.
 *
 * Every function here is async — the whole reason the old SQLite layer could be
 * called from anywhere was that better-sqlite3 blocked the event loop to do it.
 */

export async function initializeDatabase() {
    await runMigrations();
    logger.info('Postgres database ready and migrations applied');
}

export async function has(cveId) {
    const row = await queryOne('SELECT 1 FROM vulnerabilities WHERE cve_id = @cveId', { cveId });
    return Boolean(row);
}

export async function add(vuln) {
    try {
        await runSql(
            `INSERT INTO vulnerabilities (
                 cve_id, title, description, severity, cvss_score,
                 exploited, source, source_url, affected_technologies,
                 published_date, first_seen_at, last_seen_at
             ) VALUES (
                 @cveId, @title, @description, @severity, @cvssScore,
                 @exploited, @source, @sourceUrl, @affectedTechnologies,
                 @publishedDate, now(), now()
             )
             ON CONFLICT (cve_id) DO UPDATE SET
                 last_seen_at = now(),
                 source = excluded.source,
                 source_url = excluded.source_url,
                 -- A later feed knowing the date must not erase it, and must
                 -- not overwrite one already recorded either.
                 published_date = COALESCE(vulnerabilities.published_date, excluded.published_date)`,
            {
                cveId: vuln.cveId,
                title: vuln.title,
                description: vuln.description,
                severity: vuln.severity,
                cvssScore: vuln.cvssScore,
                exploited: Boolean(vuln.exploited),
                source: vuln.source || 'unknown',
                sourceUrl: vuln.link,
                affectedTechnologies: JSON.stringify(vuln.affectedTechnologies || []),
                publishedDate: vuln.publishedDate ?? null,
            }
        );
        logger.info({ cveId: vuln.cveId }, 'Added/Updated vulnerability in database');
    } catch (error) {
        logger.error({ cveId: vuln.cveId, err: error }, 'Failed to add vulnerability to database');
    }
}

/**
 * Record that an alert actually went out for this CVE.
 *
 * Stored separately from the row itself because the two happen in that order on
 * purpose: a vulnerability is persisted *before* anything is sent, so a worker
 * killed mid-send cannot resurrect the whole batch on the next cycle. What that
 * costs is the opposite mistake — a row saved and never announced — and
 * `notified_at IS NULL` is how it stays visible instead of silent.
 *
 * @param {string} cveId
 */
export async function markNotified(cveId) {
    await runSql(
        'UPDATE vulnerabilities SET notified_at = now() WHERE cve_id = @cveId',
        { cveId }
    );
}

/**
 * jsonb comes back parsed, so the only thing left is the camelCase alias the
 * rest of the code reads.
 */
function hydrate(row) {
    row.affectedTechnologies = row.affected_technologies ?? [];
    return row;
}

export async function get(cveId) {
    const row = await queryOne('SELECT * FROM vulnerabilities WHERE cve_id = @cveId', { cveId });
    return row ? hydrate(row) : null;
}

export async function update(cveId, updates) {
    const fields = [];
    const params = { cveId };

    const set = (key, column, value) => {
        if (value === undefined) return;
        fields.push(`${column} = @${key}`);
        params[key] = value;
    };

    set('status', 'status', updates.status);
    set('statusChangedBy', 'status_changed_by', updates.statusChangedBy);
    set('statusChangedAt', 'status_changed_at', updates.statusChangedAt);
    set('resolvedAt', 'resolved_at', updates.resolvedAt);
    set('clientExplanation', 'client_explanation', updates.clientExplanation);

    if (fields.length === 0) return;

    await runSql(`UPDATE vulnerabilities SET ${fields.join(', ')} WHERE cve_id = @cveId`, params);
    logger.info({ cveId, updates: Object.keys(updates) }, 'Updated vulnerability in database');
}

export async function getAll() {
    const rows = await queryAll('SELECT * FROM vulnerabilities');
    return rows.map(hydrate);
}

// Whitelist: the sort column is interpolated into SQL, so it can never come
// straight from a query string.
const SORTABLE_COLUMNS = new Set([
    'first_seen_at',
    'last_seen_at',
    'cvss_score',
    'severity',
    'status',
    'cve_id',
    'source',
    'published_date',
]);

export const QUERY_LIMIT_MAX = 200;
export const QUERY_LIMIT_DEFAULT = 50;

/**
 * Filtered, paginated query over the vulnerability table.
 *
 * getAll() loads every row, which is fine for the monitoring cycle but not for
 * a UI paging through thousands — hence the SQL-side filtering.
 *
 * @param {object} [filters]
 * @param {string} [filters.status]
 * @param {string} [filters.severity]
 * @param {string} [filters.source]
 * @param {string} [filters.tech]      Matches one entry of affected_technologies
 * @param {string} [filters.search]    Substring of cve_id or title
 * @param {boolean} [filters.exploited]
 * @param {number[]} [filters.relevantIds]  Restrict to these vulnerability ids (see application/exposure.js)
 * @param {number} [filters.limit]
 * @param {number} [filters.offset]
 * @param {string} [filters.sort]      Column from SORTABLE_COLUMNS
 * @param {'asc'|'desc'} [filters.order]
 * @returns {Promise<{ total: number, limit: number, offset: number, vulnerabilities: object[] }>}
 */
export async function query(filters = {}) {
    const clauses = [];
    const params = {};

    if (filters.status) {
        clauses.push('status = @status');
        params.status = String(filters.status).toUpperCase();
    }
    if (filters.severity) {
        clauses.push('severity = @severity');
        params.severity = String(filters.severity).toUpperCase();
    }
    if (filters.source) {
        clauses.push('lower(source) = @source');
        params.source = String(filters.source).toLowerCase();
    }
    if (filters.tech) {
        clauses.push(`EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(affected_technologies) AS tech
            WHERE lower(tech) = @tech
        )`);
        params.tech = String(filters.tech).toLowerCase();
    }
    if (filters.search) {
        clauses.push('(lower(cve_id) LIKE @search OR lower(title) LIKE @search)');
        params.search = `%${String(filters.search).toLowerCase()}%`;
    }
    if (filters.exploited !== undefined) {
        clauses.push('exploited = @exploited');
        params.exploited = Boolean(filters.exploited);
    }

    // Relevance: does this CVE name something the fleet actually uses?
    //
    // The feeds publish everything; almost none of it is about your code. The
    // link is the dependency table, which is also where container images and CI
    // actions live, so "affects a Docker image or a workflow" is the same
    // question asked of a narrower set of ecosystems.
    if (Array.isArray(filters.relevantIds)) {
        clauses.push('id = ANY(@relevantIds::bigint[])');
        params.relevantIds = filters.relevantIds;
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const sort = SORTABLE_COLUMNS.has(filters.sort) ? filters.sort : 'first_seen_at';
    const order = String(filters.order).toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    const limit = Math.min(
        Math.max(parseInt(filters.limit, 10) || QUERY_LIMIT_DEFAULT, 1),
        QUERY_LIMIT_MAX
    );
    const offset = Math.max(parseInt(filters.offset, 10) || 0, 0);

    const { total } = await queryOne(
        `SELECT COUNT(*) AS total FROM vulnerabilities ${where}`,
        params
    );

    const rows = await queryAll(
        `SELECT * FROM vulnerabilities ${where}
         ORDER BY ${sort} ${order} NULLS LAST
         LIMIT @limit OFFSET @offset`,
        { ...params, limit, offset }
    );

    return { total, limit, offset, vulnerabilities: rows.map(hydrate) };
}

/** Vulnerabilities not yet resolved. */
export async function openCount() {
    const row = await queryOne("SELECT COUNT(*) AS total FROM vulnerabilities WHERE status <> 'RESOLVED'");
    return row.total;
}

/**
 * Aggregate counts for the console overview, computed in SQL rather than by
 * materialising every row in JavaScript.
 */
export async function stats() {
    const groupBy = async column => {
        const rows = await queryAll(
            `SELECT ${column} AS key, COUNT(*) AS count FROM vulnerabilities
             GROUP BY ${column} ORDER BY count DESC`
        );
        return Object.fromEntries(rows.map(row => [row.key ?? 'UNKNOWN', row.count]));
    };

    const [totals, byStatus, bySeverity, bySource, byTechnology, activity] = await Promise.all([
        queryOne(`SELECT COUNT(*) AS total,
                         COUNT(*) FILTER (WHERE exploited) AS exploited,
                         COUNT(*) FILTER (WHERE status = 'OPEN' AND severity = 'CRITICAL') AS open_critical,
                         COUNT(*) FILTER (WHERE status = 'OPEN' AND exploited) AS open_exploited,
                         MAX(last_seen_at) AS last_seen,
                         MAX(notified_at) AS last_notified
                  FROM vulnerabilities`),
        groupBy('status'),
        groupBy('severity'),
        groupBy('source'),
        // Unrolling the jsonb array in SQL rather than shipping every row to
        // whoever asked and counting there — the CLI dashboard refreshes on a
        // timer, and it is the same question the console asks.
        queryAll(
            `SELECT lower(tech) AS key, COUNT(*) AS count
             FROM vulnerabilities, jsonb_array_elements_text(affected_technologies) AS tech
             GROUP BY lower(tech)
             ORDER BY count DESC
             LIMIT 12`
        ),
        queryAll(
            `SELECT to_char(first_seen_at::date, 'YYYY-MM-DD') AS date, COUNT(*) AS count
             FROM vulnerabilities
             WHERE first_seen_at >= current_date - interval '29 days'
             GROUP BY first_seen_at::date
             ORDER BY first_seen_at::date`
        ),
    ]);

    return {
        total: totals.total,
        exploited: totals.exploited,
        openCritical: totals.open_critical,
        openExploited: totals.open_exploited,
        lastSeenAt: totals.last_seen,
        lastNotifiedAt: totals.last_notified,
        byStatus,
        bySeverity,
        bySource,
        byTechnology: Object.fromEntries(byTechnology.map(row => [row.key, row.count])),
        activity,
    };
}
