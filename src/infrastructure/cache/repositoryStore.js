import { query, queryAll, queryOne, withTransaction } from '../db/pool.js';
import logger from '../logger.js';

/**
 * "This dependency is named in that CVE."
 *
 * affected_technologies is a jsonb array, so the test is equality over its
 * elements. Written once here and once in postgresCache.js, where the same
 * question drives the relevance counters — the two must agree, and a shared
 * fragment across modules would hide that they are the same rule.
 */
const NAMES_DEPENDENCY = `EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(v.affected_technologies) AS tech
    WHERE lower(tech) = lower(d.name)
       OR (d.opencve_product IS NOT NULL AND lower(tech) = lower(d.opencve_product))
)`;

// ── Repositories ──

export async function addRepository({
    name,
    url,
    provider,
    orgKey,
    defaultBranch = 'main',
    primaryLanguage = null,
    languages = null,
    topics = null,
    description = null,
    archived = false,
    enabled = true,
}) {
    // RETURNING rather than a follow-up read: on the conflict path the upsert
    // updates an existing row, and there is no insert id to look up.
    const row = await queryOne(
        `INSERT INTO repositories (
             name, url, provider, org_key, default_branch,
             primary_language, languages, topics, description, archived, enabled
         )
         VALUES (
             @name, @url, @provider, @orgKey, @defaultBranch,
             @primaryLanguage, @languages, @topics, @description, @archived, @enabled
         )
         ON CONFLICT (url) DO UPDATE SET
             name = excluded.name,
             provider = excluded.provider,
             org_key = excluded.org_key,
             default_branch = excluded.default_branch,
             primary_language = excluded.primary_language,
             -- A re-import without a language breakdown must not erase the one
             -- already stored.
             languages = COALESCE(excluded.languages, repositories.languages),
             topics = COALESCE(excluded.topics, repositories.topics),
             description = excluded.description,
             archived = excluded.archived,
             updated_at = now(),
             deleted_at = NULL
             -- The enabled column is intentionally absent: it is the operator's
             -- switch, and a re-import must not flip it back.
         RETURNING *`,
        {
            name,
            url,
            provider,
            orgKey,
            defaultBranch,
            primaryLanguage,
            languages: languages ? JSON.stringify(languages) : null,
            topics: topics ? JSON.stringify(topics) : null,
            description,
            archived: Boolean(archived),
            enabled: Boolean(enabled),
        }
    );

    logger.info({ url, id: row?.id }, 'Repository added/restored');
    return row ?? await getRepositoryByUrl(url);
}

export async function softDeleteRepository(id) {
    await withTransaction(async client => {
        await query(
            `UPDATE repositories SET deleted_at = now(), updated_at = now()
             WHERE id = @id AND deleted_at IS NULL`,
            { id },
            client
        );
        await query(
            `UPDATE repository_dependencies SET deleted_at = now(), updated_at = now()
             WHERE repository_id = @id AND deleted_at IS NULL`,
            { id },
            client
        );
    });

    logger.info({ id }, 'Repository soft-deleted with dependencies');
}

export async function getRepository(id) {
    return queryOne('SELECT * FROM repositories WHERE id = @id', { id });
}

export async function getRepositoryByUrl(url) {
    return queryOne('SELECT * FROM repositories WHERE url = @url AND deleted_at IS NULL', { url });
}

/**
 * Including the soft-deleted ones, which the importer needs: a repository the
 * operator removed must not come back on the next import.
 */
export async function getAnyRepositoryByUrl(url) {
    return queryOne('SELECT * FROM repositories WHERE url = @url', { url });
}

/** Restore a soft-deleted repository. */
export async function restoreRepository(id) {
    await withTransaction(async client => {
        await query(
            'UPDATE repositories SET deleted_at = NULL, updated_at = now() WHERE id = @id',
            { id },
            client
        );
        await query(
            `UPDATE repository_dependencies SET deleted_at = NULL, updated_at = now()
             WHERE repository_id = @id`,
            { id },
            client
        );
    });

    logger.info({ id }, 'Repository restored');
    return await getRepository(id);
}

export async function listRepositories({ includeDeleted = false } = {}) {
    const where = includeDeleted ? '' : 'WHERE deleted_at IS NULL';
    return queryAll(`SELECT * FROM repositories ${where} ORDER BY name`);
}

export async function updateRepository(id, updates) {
    const fields = [];
    const values = { id };

    if (updates.name !== undefined) { fields.push('name = @name'); values.name = updates.name; }
    if (updates.enabled !== undefined) { fields.push('enabled = @enabled'); values.enabled = Boolean(updates.enabled); }
    if (updates.lastScannedAt !== undefined) { fields.push('last_scanned_at = @lastScannedAt'); values.lastScannedAt = updates.lastScannedAt; }
    if (updates.defaultBranch !== undefined) { fields.push('default_branch = @defaultBranch'); values.defaultBranch = updates.defaultBranch; }
    if (updates.languages !== undefined) { fields.push('languages = @languages'); values.languages = updates.languages ? JSON.stringify(updates.languages) : null; }
    if (updates.primaryLanguage !== undefined) { fields.push('primary_language = @primaryLanguage'); values.primaryLanguage = updates.primaryLanguage; }
    if (updates.topics !== undefined) { fields.push('topics = @topics'); values.topics = updates.topics ? JSON.stringify(updates.topics) : null; }

    if (fields.length === 0) return;

    fields.push('updated_at = now()');
    await query(`UPDATE repositories SET ${fields.join(', ')} WHERE id = @id`, values);
}

// ── Dependencies ──

export async function replaceDependencies(repoId, deps) {
    await withTransaction(async client => {
        // Soft-delete every current dependency, then upsert the ones the scan
        // found: a dependency that is still there is restored by its own upsert,
        // and one that is gone stays deleted.
        await query(
            `UPDATE repository_dependencies
             SET deleted_at = now(), updated_at = now()
             WHERE repository_id = @repoId AND deleted_at IS NULL`,
            { repoId },
            client
        );

        for (const dep of deps) {
            await query(
                `INSERT INTO repository_dependencies
                     (repository_id, ecosystem, name, version, manifest_file, opencve_vendor, opencve_product)
                 VALUES (@repositoryId, @ecosystem, @name, @version, @manifestFile, @opencveVendor, @opencveProduct)
                 ON CONFLICT (repository_id, ecosystem, name, manifest_file) DO UPDATE SET
                     version = excluded.version,
                     opencve_vendor = excluded.opencve_vendor,
                     opencve_product = excluded.opencve_product,
                     updated_at = now(),
                     deleted_at = NULL`,
                {
                    repositoryId: repoId,
                    ecosystem: dep.ecosystem,
                    name: dep.name,
                    version: dep.version || null,
                    manifestFile: dep.manifestFile || null,
                    opencveVendor: dep.opencveVendor || null,
                    opencveProduct: dep.opencveProduct || null,
                },
                client
            );
        }
    });

    logger.info({ repoId, count: deps.length }, 'Dependencies replaced');
}

export async function getDependenciesByRepo(repoId, { includeDeleted = false } = {}) {
    const where = includeDeleted
        ? 'WHERE repository_id = @repoId'
        : 'WHERE repository_id = @repoId AND deleted_at IS NULL';

    return queryAll(
        `SELECT * FROM repository_dependencies ${where} ORDER BY ecosystem, name`,
        { repoId }
    );
}

export async function findAffectedRepositories(vendor, product) {
    return queryAll(
        `SELECT DISTINCT r.*
         FROM repositories r
         JOIN repository_dependencies d ON d.repository_id = r.id
         WHERE d.opencve_vendor = @vendor AND d.opencve_product = @product
           AND d.deleted_at IS NULL
           AND r.deleted_at IS NULL
           AND r.enabled`,
        { vendor, product }
    );
}

/**
 * Affected repositories by dependency name, for when there is no vendor/product
 * mapping but there is a technology name.
 */
export async function findAffectedRepositoriesByDepName(depName) {
    return queryAll(
        `SELECT DISTINCT r.*
         FROM repositories r
         JOIN repository_dependencies d ON d.repository_id = r.id
         WHERE lower(d.name) = lower(@depName)
           AND d.deleted_at IS NULL
           AND r.deleted_at IS NULL
           AND r.enabled`,
        { depName }
    );
}

// ── System owners ──

export async function addOwner({ name, email, slackUserId = null }) {
    const row = await queryOne(
        `INSERT INTO system_owners (name, email, slack_user_id)
         VALUES (@name, @email, @slackUserId)
         ON CONFLICT (email) DO UPDATE SET
             name = excluded.name,
             slack_user_id = excluded.slack_user_id,
             updated_at = now(),
             deleted_at = NULL
         RETURNING *`,
        { name, email, slackUserId }
    );

    logger.info({ email, id: row?.id }, 'Owner added/restored');
    return row ?? await getOwnerByEmail(email);
}

export async function softDeleteOwner(id) {
    await withTransaction(async client => {
        await query(
            `UPDATE system_owners SET deleted_at = now(), updated_at = now()
             WHERE id = @id AND deleted_at IS NULL`,
            { id },
            client
        );
        await query(
            'UPDATE owner_assignments SET deleted_at = now() WHERE owner_id = @id AND deleted_at IS NULL',
            { id },
            client
        );
    });

    logger.info({ id }, 'Owner soft-deleted with assignments');
}

export async function getOwner(id) {
    return queryOne('SELECT * FROM system_owners WHERE id = @id AND deleted_at IS NULL', { id });
}

export async function getOwnerByEmail(email) {
    return queryOne('SELECT * FROM system_owners WHERE email = @email AND deleted_at IS NULL', { email });
}

export async function listOwners({ includeDeleted = false } = {}) {
    const where = includeDeleted ? '' : 'WHERE deleted_at IS NULL';
    return queryAll(`SELECT * FROM system_owners ${where} ORDER BY name`);
}

export async function updateOwner(id, updates) {
    const fields = [];
    const values = { id };

    if (updates.name !== undefined) { fields.push('name = @name'); values.name = updates.name; }
    if (updates.email !== undefined) { fields.push('email = @email'); values.email = updates.email; }
    if (updates.slackUserId !== undefined) { fields.push('slack_user_id = @slackUserId'); values.slackUserId = updates.slackUserId; }

    if (fields.length === 0) return;

    fields.push('updated_at = now()');
    await query(`UPDATE system_owners SET ${fields.join(', ')} WHERE id = @id`, values);
}

// ── Owner assignments ──

export async function addAssignment({ ownerId, targetType, targetValue }) {
    const row = await queryOne(
        `INSERT INTO owner_assignments (owner_id, target_type, target_value)
         VALUES (@ownerId, @targetType, @targetValue)
         ON CONFLICT (owner_id, target_type, target_value) DO UPDATE SET
             deleted_at = NULL
         RETURNING *`,
        { ownerId, targetType, targetValue }
    );

    logger.info({ ownerId, targetType, targetValue }, 'Assignment added/restored');
    return row;
}

export async function softDeleteAssignment(assignmentId) {
    await query(
        'UPDATE owner_assignments SET deleted_at = now() WHERE id = @assignmentId AND deleted_at IS NULL',
        { assignmentId }
    );
}

export async function getAssignmentsByOwner(ownerId) {
    return queryAll(
        `SELECT * FROM owner_assignments WHERE owner_id = @ownerId AND deleted_at IS NULL
         ORDER BY target_type, target_value`,
        { ownerId }
    );
}

/**
 * Owners responsible for a vulnerability, by matching assignments against its
 * ecosystem, its dependency names, or the repositories it reaches.
 */
export async function findOwnersForVulnerability({ vendor, product, ecosystem, depNames = [], repoUrls = [] }) {
    const conditions = [];
    const params = {};

    if (ecosystem) {
        conditions.push("(a.target_type = 'ecosystem' AND lower(a.target_value) = lower(@ecosystem))");
        params.ecosystem = ecosystem;
    }

    for (let i = 0; i < depNames.length; i++) {
        conditions.push(`(a.target_type = 'dependency' AND lower(a.target_value) = lower(@dep${i}))`);
        params[`dep${i}`] = depNames[i];
    }

    for (let i = 0; i < repoUrls.length; i++) {
        conditions.push(`(a.target_type = 'repository' AND a.target_value = @repo${i})`);
        params[`repo${i}`] = repoUrls[i];
    }

    if (conditions.length === 0) return [];

    return queryAll(
        `SELECT DISTINCT o.*
         FROM system_owners o
         JOIN owner_assignments a ON a.owner_id = o.id
         WHERE (${conditions.join(' OR ')})
           AND a.deleted_at IS NULL
           AND o.deleted_at IS NULL`,
        params
    );
}

// ── Vendor/product mappings ──

export async function getVendorProductMapping(ecosystem, packageName) {
    const row = await queryOne(
        `SELECT opencve_vendor, opencve_product FROM vendor_product_mappings
         WHERE ecosystem = @ecosystem AND package_name = @packageName`,
        { ecosystem, packageName }
    );

    return row ? { vendor: row.opencve_vendor, product: row.opencve_product } : null;
}

export async function setVendorProductMapping(ecosystem, packageName, vendor, product) {
    await query(
        `INSERT INTO vendor_product_mappings (ecosystem, package_name, opencve_vendor, opencve_product)
         VALUES (@ecosystem, @packageName, @vendor, @product)
         ON CONFLICT (ecosystem, package_name) DO UPDATE SET
             opencve_vendor = excluded.opencve_vendor,
             opencve_product = excluded.opencve_product,
             updated_at = now()`,
        { ecosystem, packageName, vendor, product }
    );
}

export async function getAllUniqueDependencies() {
    return queryAll(
        `SELECT DISTINCT name, ecosystem, opencve_vendor, opencve_product
         FROM repository_dependencies
         WHERE deleted_at IS NULL
         ORDER BY ecosystem, name`
    );
}

/**
 * Seed vendor/product mappings from a JSON array.
 * @param {{ ecosystem: string, packageName: string, vendor: string, product: string }[]} mappings
 */
export async function seedVendorProductMappings(mappings) {
    await withTransaction(async client => {
        for (const m of mappings) {
            await query(
                `INSERT INTO vendor_product_mappings (ecosystem, package_name, opencve_vendor, opencve_product)
                 VALUES (@ecosystem, @packageName, @vendor, @product)
                 ON CONFLICT (ecosystem, package_name) DO NOTHING`,
                m,
                client
            );
        }
    });

    logger.info({ count: mappings.length }, 'Seeded vendor/product mappings');
}

// ── Repository exposure ──

/**
 * Vulnerabilities that touch a repository, by way of its dependencies.
 *
 * The link is computed rather than stored: a dependency list changes with every
 * scan and a vulnerability's technologies can be enriched after the fact, so a
 * stored join would go stale silently. One row per (CVE, matching dependency) —
 * the caller groups them.
 *
 * @param {number} repoId
 * @param {{ includeResolved?: boolean }} [options]
 */
export async function findVulnerabilitiesForRepository(repoId, { includeResolved = false } = {}) {
    const statusClause = includeResolved ? '' : "AND v.status <> 'RESOLVED'";

    return queryAll(
        `SELECT v.*,
                d.name AS matched_dependency,
                d.ecosystem AS matched_ecosystem,
                d.version AS matched_version,
                d.manifest_file AS matched_manifest
         FROM repository_dependencies d
         JOIN vulnerabilities v ON ${NAMES_DEPENDENCY}
         WHERE d.repository_id = @repoId
           AND d.deleted_at IS NULL
           ${statusClause}
         ORDER BY v.cvss_score DESC NULLS LAST, v.cve_id`,
        { repoId }
    );
}

/**
 * How exposed every tracked repository is, in one pass.
 * Used for the list view, where running the per-repository query N times would
 * mean N round trips for a column.
 *
 * @returns {Promise<Map<number, { total: number, bySeverity: Record<string, number>, exploited: boolean }>>}
 */
export async function summarizeRepositoryExposure() {
    const rows = await queryAll(
        `SELECT d.repository_id AS "repositoryId",
                v.severity AS severity,
                bool_or(v.exploited) AS exploited,
                COUNT(DISTINCT v.cve_id) AS total
         FROM repository_dependencies d
         JOIN repositories r ON r.id = d.repository_id AND r.deleted_at IS NULL
         JOIN vulnerabilities v ON ${NAMES_DEPENDENCY}
         WHERE d.deleted_at IS NULL
           AND v.status <> 'RESOLVED'
         GROUP BY d.repository_id, v.severity`
    );

    const byRepo = new Map();

    for (const row of rows) {
        const entry = byRepo.get(row.repositoryId) ?? { total: 0, bySeverity: {}, exploited: false };
        entry.bySeverity[row.severity ?? 'UNKNOWN'] = row.total;
        entry.total += row.total;
        entry.exploited = entry.exploited || Boolean(row.exploited);
        byRepo.set(row.repositoryId, entry);
    }

    return byRepo;
}

// Whitelist: the sort column is interpolated into SQL, so it can never come
// straight from a query string.
const REPOSITORY_SORT_COLUMNS = new Set([
    'name',
    'primary_language',
    'last_scanned_at',
    'created_at',
    'updated_at',
    'org_key',
    'default_branch',
]);

export const REPOSITORY_LIMIT_DEFAULT = 25;
export const REPOSITORY_LIMIT_MAX = 200;

/**
 * Filtered list of repositories, sorted in SQL.
 *
 * Pagination happens above this, in the application layer: the exposure of each
 * repository is computed from the vulnerability table rather than stored, so
 * ordering by it cannot be expressed here.
 *
 * @param {object} [filters]
 * @param {string} [filters.search]     Substring of name or description
 * @param {string} [filters.org]        org_key
 * @param {string} [filters.language]   primary_language
 * @param {boolean} [filters.enabled]
 * @param {boolean} [filters.archived]
 * @param {boolean} [filters.includeDeleted]
 * @param {string} [filters.sort]
 * @param {'asc'|'desc'} [filters.order]
 */
export async function queryRepositories(filters = {}) {
    const clauses = [];
    const params = {};

    if (!filters.includeDeleted) clauses.push('deleted_at IS NULL');

    if (filters.search) {
        clauses.push('(lower(name) LIKE @search OR lower(description) LIKE @search)');
        params.search = `%${String(filters.search).toLowerCase()}%`;
    }
    if (filters.org) {
        clauses.push('org_key = @org');
        params.org = filters.org;
    }
    if (filters.language) {
        clauses.push('lower(primary_language) = @language');
        params.language = String(filters.language).toLowerCase();
    }
    if (filters.enabled !== undefined) {
        clauses.push('enabled = @enabled');
        params.enabled = Boolean(filters.enabled);
    }
    if (filters.archived !== undefined) {
        clauses.push('archived = @archived');
        params.archived = Boolean(filters.archived);
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const sort = REPOSITORY_SORT_COLUMNS.has(filters.sort) ? filters.sort : 'name';
    const order = String(filters.order).toLowerCase() === 'desc' ? 'DESC' : 'ASC';

    // NULLs last whichever way the sort runs: a repository that was never
    // scanned is not the most recently scanned one.
    return queryAll(
        `SELECT * FROM repositories ${where} ORDER BY ${sort} ${order} NULLS LAST, name ASC`,
        params
    );
}

/** Values the console offers in its filter menus. */
export async function repositoryFacets() {
    const [organizations, languages] = await Promise.all([
        queryAll(
            `SELECT org_key AS value, COUNT(*) AS count FROM repositories
             WHERE deleted_at IS NULL AND org_key IS NOT NULL
             GROUP BY org_key ORDER BY value`
        ),
        queryAll(
            `SELECT primary_language AS value, COUNT(*) AS count FROM repositories
             WHERE deleted_at IS NULL AND primary_language IS NOT NULL
             GROUP BY primary_language ORDER BY count DESC, value`
        ),
    ]);

    return { organizations, languages };
}

/**
 * Record the outcome of one registry lookup.
 *
 * Written per dependency, as each answer arrives: a check interrupted halfway
 * leaves everything it already resolved, and the console can render partial
 * results while the rest is still in flight.
 */
export async function setDependencyLatestVersion(dependencyId, { latest = null, error = null }) {
    await query(
        `UPDATE repository_dependencies
         SET latest_version = @latest,
             latest_error = @error,
             latest_checked_at = now()
         WHERE id = @id`,
        { id: dependencyId, latest, error }
    );
}
