import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import logger from '../logger.js';
import { runMigrations } from './migrationRunner.js';

// Resolve project root from this file's location so paths work regardless of cwd
// (e.g., when the CLI is invoked globally from another directory).
const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = path.resolve(path.dirname(__filename), '..', '..', '..');

/**
 * Resolved when the connection is opened, not when this module is imported:
 * the CLI sets DB_PATH from `--db` after its own imports have run, and reading
 * it at import time would silently pin every command to the default database.
 */
function resolveDbPath() {
    return process.env.DB_PATH || path.join(PROJECT_ROOT, 'data/atalaia.db');
}

let db;

export function initializeDatabase() {
    const dbPath = resolveDbPath();
    const dbDir = path.dirname(dbPath);
    if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
    }

    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');

    runMigrations(db);

    logger.info('SQLite database initialized and migrations applied');
}

export function getDb() {
    if (!db) {
        initializeDatabase();
    }
    return db;
}

export function has(cveId) {
    const stmt = getDb().prepare('SELECT 1 FROM vulnerabilities WHERE cve_id = ?');
    return !!stmt.get(cveId);
}

export function add(vuln) {
    const stmt = getDb().prepare(`
        INSERT INTO vulnerabilities (
            cve_id, title, description, severity, cvss_score, 
            exploited, source, source_url, affected_technologies, 
            first_seen_at, last_seen_at
        ) VALUES (
            @cveId, @title, @description, @severity, @cvssScore, 
            @exploited, @source, @sourceUrl, @affectedTechnologies, 
            datetime('now'), datetime('now')
        )
        ON CONFLICT(cve_id) DO UPDATE SET
            last_seen_at = datetime('now'),
            source = excluded.source,
            source_url = excluded.source_url
    `);

    try {
        stmt.run({
            cveId: vuln.cveId,
            title: vuln.title,
            description: vuln.description,
            severity: vuln.severity,
            cvssScore: vuln.cvssScore,
            exploited: vuln.exploited ? 1 : 0,
            source: vuln.source || 'unknown', // Default if missing
            sourceUrl: vuln.link,
            affectedTechnologies: JSON.stringify(vuln.affectedTechnologies || [])
        });
        logger.info({ cveId: vuln.cveId }, 'Added/Updated vulnerability in database');
    } catch (error) {
        logger.error({ cveId: vuln.cveId, err: error }, 'Failed to add vulnerability to database');
    }
}

export function get(cveId) {
    const stmt = getDb().prepare('SELECT * FROM vulnerabilities WHERE cve_id = ?');
    const row = stmt.get(cveId);
    if (!row) return null;
    row.affectedTechnologies = row.affected_technologies ? JSON.parse(row.affected_technologies) : [];
    return row;
}

export function update(cveId, updates) {
    const fields = [];
    const values = {};
    values.cveId = cveId;

    if (updates.status !== undefined) {
        fields.push('status = @status');
        values.status = updates.status;
    }
    if (updates.statusChangedBy !== undefined) {
        fields.push('status_changed_by = @statusChangedBy');
        values.statusChangedBy = updates.statusChangedBy;
    }
    if (updates.statusChangedAt !== undefined) {
        fields.push('status_changed_at = @statusChangedAt');
        values.statusChangedAt = updates.statusChangedAt;
    }
    if (updates.resolvedAt !== undefined) {
        fields.push('resolved_at = @resolvedAt');
        values.resolvedAt = updates.resolvedAt;
    }
    if (updates.clientExplanation !== undefined) {
        fields.push('client_explanation = @clientExplanation');
        values.clientExplanation = updates.clientExplanation;
    }

    if (fields.length === 0) return;

    const sql = `UPDATE vulnerabilities SET ${fields.join(', ')} WHERE cve_id = @cveId`;
    const stmt = getDb().prepare(sql);
    stmt.run(values);
    logger.info({ cveId, updates: Object.keys(updates) }, 'Updated vulnerability in database');
}

function hydrate(row) {
    row.affectedTechnologies = row.affected_technologies ? JSON.parse(row.affected_technologies) : [];
    return row;
}

export function getAll() {
    const stmt = getDb().prepare('SELECT * FROM vulnerabilities');
    return stmt.all().map(hydrate);
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
]);

/**
 * "Names something this fleet actually uses."
 *
 * One definition, shared by the filter and by the counters, so the number in
 * the header can never disagree with the rows under it. Container images and CI
 * actions are dependencies like any other — `infrastructure` is the same
 * question asked of just those ecosystems.
 */
function relevanceExists(kind) {
    const ecosystemClause =
        kind === 'infrastructure'
            ? "AND d.ecosystem IN ('DOCKER', 'GITHUB_ACTIONS', 'TERRAFORM', 'HELM')"
            : '';

    return `EXISTS (
        SELECT 1
        FROM repository_dependencies d
        JOIN repositories r ON r.id = d.repository_id
        WHERE d.deleted_at IS NULL
          AND r.deleted_at IS NULL
          AND r.enabled = 1
          ${ecosystemClause}
          AND (
            lower(vulnerabilities.affected_technologies) LIKE '%"' || lower(d.name) || '"%'
            OR (d.opencve_product IS NOT NULL
                AND lower(vulnerabilities.affected_technologies) LIKE '%"' || lower(d.opencve_product) || '"%')
          )
    )`;
}

export const QUERY_LIMIT_MAX = 200;
export const QUERY_LIMIT_DEFAULT = 50;

/**
 * Filtered, paginated query over the vulnerability table.
 *
 * getAll() loads every row, which is fine for the monitoring cycle but not for
 * a UI that pages through thousands of records — hence the SQL-side filtering.
 *
 * @param {object} [filters]
 * @param {string} [filters.status]
 * @param {string} [filters.severity]
 * @param {string} [filters.source]
 * @param {string} [filters.tech]      Matches one entry of affected_technologies
 * @param {string} [filters.search]    Substring of cve_id or title
 * @param {boolean} [filters.exploited]
 * @param {'affecting'|'infrastructure'} [filters.relevance]
 * @param {number} [filters.limit]
 * @param {number} [filters.offset]
 * @param {string} [filters.sort]      Column from SORTABLE_COLUMNS
 * @param {'asc'|'desc'} [filters.order]
 * @returns {{ total: number, limit: number, offset: number, vulnerabilities: object[] }}
 */
export function query(filters = {}) {
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
        // affected_technologies is a JSON array as text; quoting the term keeps
        // "react" from matching "react-dom".
        clauses.push('lower(affected_technologies) LIKE @tech');
        params.tech = `%"${String(filters.tech).toLowerCase()}"%`;
    }
    if (filters.search) {
        clauses.push('(lower(cve_id) LIKE @search OR lower(title) LIKE @search)');
        params.search = `%${String(filters.search).toLowerCase()}%`;
    }
    if (filters.exploited !== undefined) {
        clauses.push('exploited = @exploited');
        params.exploited = filters.exploited ? 1 : 0;
    }

    // Relevance: does this CVE name something the fleet actually uses?
    //
    // The feeds publish everything; almost none of it is about your code. The
    // link is the dependency table, which is also where container images and CI
    // actions live, so "affects a Docker image or a workflow" is the same
    // question asked of a narrower set of ecosystems.
    if (filters.relevance === 'affecting' || filters.relevance === 'infrastructure') {
        clauses.push(relevanceExists(filters.relevance));
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const sort = SORTABLE_COLUMNS.has(filters.sort) ? filters.sort : 'first_seen_at';
    const order = String(filters.order).toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    const limit = Math.min(
        Math.max(parseInt(filters.limit, 10) || QUERY_LIMIT_DEFAULT, 1),
        QUERY_LIMIT_MAX
    );
    const offset = Math.max(parseInt(filters.offset, 10) || 0, 0);

    const database = getDb();
    const { total } = database
        .prepare(`SELECT COUNT(*) AS total FROM vulnerabilities ${where}`)
        .get(params);

    const rows = database
        .prepare(
            `SELECT * FROM vulnerabilities ${where}
             ORDER BY ${sort} ${order}
             LIMIT @limit OFFSET @offset`
        )
        .all({ ...params, limit, offset })
        .map(hydrate);

    return { total, limit, offset, vulnerabilities: rows };
}

/**
 * How much of the database is actually about this fleet.
 *
 * The feeds publish tens of thousands of CVEs a year and almost none of them
 * name something you run — so the console leads with the ones that do, and
 * these are the numbers behind that.
 */
export function relevanceSummary() {
    const openClause = "status != 'RESOLVED'";

    const count = where => getDb().prepare(`SELECT COUNT(*) AS total FROM vulnerabilities WHERE ${where}`).get().total;

    return {
        total: count(openClause),
        affecting: count(`${openClause} AND ${relevanceExists('affecting')}`),
        infrastructure: count(`${openClause} AND ${relevanceExists('infrastructure')}`),
    };
}

/**
 * Aggregate counts for the console overview, computed in SQL rather than by
 * materialising every row in JavaScript.
 */
export function stats() {
    const database = getDb();
    const groupBy = column =>
        Object.fromEntries(
            database
                .prepare(
                    `SELECT ${column} AS key, COUNT(*) AS count FROM vulnerabilities
                     GROUP BY ${column} ORDER BY count DESC`
                )
                .all()
                .map(row => [row.key ?? 'UNKNOWN', row.count])
        );

    const { total } = database.prepare('SELECT COUNT(*) AS total FROM vulnerabilities').get();
    const { exploited } = database
        .prepare('SELECT COUNT(*) AS exploited FROM vulnerabilities WHERE exploited = 1')
        .get();
    const { lastSeen } = database
        .prepare('SELECT MAX(last_seen_at) AS lastSeen FROM vulnerabilities')
        .get();

    return {
        total,
        exploited,
        lastSeenAt: lastSeen,
        byStatus: groupBy('status'),
        bySeverity: groupBy('severity'),
        bySource: groupBy('source'),
    };
}
