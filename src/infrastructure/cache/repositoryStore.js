import { query, queryAll, queryOne, withTransaction } from '../db/pool.js';
import logger from '../logger.js';

/**
 * "Which CVE names which dependency."
 *
 * One row per (vulnerability, lowercased technology it names), to be joined
 * against the fleet on equality. It was a correlated EXISTS that re-unrolled
 * each vulnerability's jsonb array once per candidate dependency — thirteen
 * million comparisons on a fleet of four hundred repositories, and a request
 * that took the best part of a minute. Unrolling once and hash-joining is the
 * same answer in a fraction of the time.
 *
 * The only definition of the join. The relevance counters, the exposure list,
 * the reports and the alerts all read it through `candidateLinks()`, and what
 * the version check then clears is decided once, in application/exposure.js.
 */
const TECHNOLOGY_ROWS = `
    SELECT v.id, v.cve_id, lower(element) AS name
    FROM vulnerabilities v,
         jsonb_array_elements_text(v.affected_technologies) AS element
`;

/**
 * One row per (repository, dependency, lowercased name we ship). A CVE can name
 * the dependency itself or the vendor's product name for it, so both are here.
 */
const FLEET_ROWS = `
    SELECT d.id AS dependency_id, d.repository_id, d.ecosystem, d.name, d.version, d.versions,
           d.manifest_file, lower(d.name) AS match_name, 'name' AS match_kind
    FROM repository_dependencies d
    WHERE d.deleted_at IS NULL
    UNION ALL
    SELECT d.id AS dependency_id, d.repository_id, d.ecosystem, d.name, d.version, d.versions,
           d.manifest_file, lower(d.opencve_product) AS match_name, 'vendor_product' AS match_kind
    FROM repository_dependencies d
    WHERE d.deleted_at IS NULL AND d.opencve_product IS NOT NULL
`;

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
                     (repository_id, ecosystem, name, version, versions, manifest_file, opencve_vendor, opencve_product)
                 VALUES (@repositoryId, @ecosystem, @name, @version, @versions::jsonb, @manifestFile, @opencveVendor, @opencveProduct)
                 ON CONFLICT (repository_id, ecosystem, name, manifest_file) DO UPDATE SET
                     version = excluded.version,
                     versions = excluded.versions,
                     opencve_vendor = excluded.opencve_vendor,
                     opencve_product = excluded.opencve_product,
                     updated_at = now(),
                     deleted_at = NULL`,
                {
                    repositoryId: repoId,
                    ecosystem: dep.ecosystem,
                    name: dep.name,
                    version: dep.version || null,
                    versions: Array.isArray(dep.versions) ? JSON.stringify(dep.versions) : null,
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

// ── System owners ──

export async function addOwner({ name, email, slackUserId = null, telegramChatId = null }) {
    const row = await queryOne(
        `INSERT INTO system_owners (name, email, slack_user_id, telegram_chat_id)
         VALUES (@name, @email, @slackUserId, @telegramChatId)
         ON CONFLICT (email) DO UPDATE SET
             name = excluded.name,
             slack_user_id = excluded.slack_user_id,
             telegram_chat_id = excluded.telegram_chat_id,
             updated_at = now(),
             deleted_at = NULL
         RETURNING *`,
        { name, email, slackUserId, telegramChatId }
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
    if (updates.telegramChatId !== undefined) { fields.push('telegram_chat_id = @telegramChatId'); values.telegramChatId = updates.telegramChatId; }

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
 * Every (vulnerability, dependency) pair that shares a name — the candidates,
 * before anything has asked whether the dependency's *version* is affected.
 *
 * The link is computed rather than stored: a dependency list changes with every
 * scan and a vulnerability's technologies can be enriched after the fact, so a
 * stored join would go stale silently. One row per (CVE, dependency, how it
 * matched); application/exposure.js decides which of them are real.
 *
 * @param {object} [options]
 * @param {number} [options.repositoryId]  One repository
 * @param {string} [options.cveId]         One vulnerability
 * @param {boolean} [options.enabledOnly]  Skip repositories switched off
 * @param {boolean} [options.includeResolved]
 * @param {string} [options.since]         first_seen_at lower bound, which is what makes a report weekly
 */
export async function candidateLinks({
    repositoryId = null,
    cveId = null,
    enabledOnly = false,
    includeResolved = false,
    since = null,
} = {}) {
    const clauses = ['r.deleted_at IS NULL'];
    if (repositoryId !== null) clauses.push('fleet.repository_id = @repositoryId');
    if (cveId !== null) clauses.push('v.cve_id = @cveId');
    if (enabledOnly) clauses.push('r.enabled');
    if (!includeResolved) clauses.push("v.status <> 'RESOLVED'");
    if (since) clauses.push('v.first_seen_at >= @since');

    return queryAll(
        `WITH tech AS (${TECHNOLOGY_ROWS}), fleet AS (${FLEET_ROWS})
         SELECT v.id AS vulnerability_id,
                v.cve_id,
                v.title,
                v.severity,
                v.cvss_score,
                v.exploited,
                v.status,
                v.description,
                v.client_explanation,
                v.source,
                v.source_url,
                v.first_seen_at,
                r.id   AS repository_id,
                r.name AS repository_name,
                r.url  AS repository_url,
                fleet.dependency_id,
                fleet.name AS dependency,
                fleet.ecosystem AS ecosystem,
                fleet.version AS version,
                fleet.versions AS versions,
                fleet.manifest_file AS manifest_file,
                fleet.match_kind AS match_kind
         FROM fleet
         JOIN repositories r ON r.id = fleet.repository_id
         JOIN tech ON tech.name = fleet.match_name
         JOIN vulnerabilities v ON v.id = tech.id
         WHERE ${clauses.join(' AND ')}
         ORDER BY r.name, v.cvss_score DESC NULLS LAST, v.cve_id`,
        { repositoryId, cveId, since }
    );
}

/**
 * What advisories say about the packages of these vulnerabilities.
 *
 * @param {number[]} vulnerabilityIds
 * @returns {Promise<Map<number, { ecosystem: string, name: string, vulnerableRange: string, firstPatched: string|null }[]>>}
 */
export async function advisoryPackagesFor(vulnerabilityIds) {
    const byVulnerability = new Map();
    if (vulnerabilityIds.length === 0) return byVulnerability;

    const rows = await queryAll(
        `SELECT vulnerability_id, ecosystem, package_name, vulnerable_range, first_patched
         FROM advisory_packages
         WHERE vulnerability_id = ANY(@ids::bigint[])`,
        { ids: vulnerabilityIds }
    );

    for (const row of rows) {
        const list = byVulnerability.get(row.vulnerability_id) ?? [];
        list.push({
            ecosystem: row.ecosystem,
            name: row.package_name,
            vulnerableRange: row.vulnerable_range,
            firstPatched: row.first_patched,
        });
        byVulnerability.set(row.vulnerability_id, list);
    }

    return byVulnerability;
}

/**
 * @param {number[]} ids
 * @returns {Promise<object[]>} repository rows, not deleted and enabled
 */
export async function getRepositoriesByIds(ids) {
    if (ids.length === 0) return [];

    return queryAll(
        `SELECT * FROM repositories
         WHERE id = ANY(@ids::bigint[]) AND deleted_at IS NULL AND enabled
         ORDER BY name`,
        { ids }
    );
}

/**
 * Dependencies whose registry has something newer, per repository.
 *
 * The comparison itself is not SQL — a manifest declares a constraint, not a
 * version, and `compareVersions()` is what knows the difference. This returns
 * the rows worth comparing: checked, with an answer, and not obviously equal.
 */
export async function dependenciesWithLatest() {
    return queryAll(
        `SELECT r.id AS repository_id, r.name AS repository_name, r.url AS repository_url,
                d.ecosystem, d.name, d.version, d.latest_version, d.manifest_file
         FROM repository_dependencies d
         JOIN repositories r ON r.id = d.repository_id
         WHERE d.deleted_at IS NULL
           AND r.deleted_at IS NULL
           AND r.enabled
           AND d.latest_version IS NOT NULL
           AND d.latest_error IS NULL
         ORDER BY r.name, d.ecosystem, d.name`
    );
}

/**
 * Every live dependency, with its freshness columns as they were written.
 *
 * dependenciesWithLatest() above drops anything unresolved, because the digest
 * only lists what is behind. A report has to state what was never asked as well:
 * a dependency with no latest_checked_at is not up to date, it is unknown, and
 * folding it into "current" is the one mistake that makes the whole number a lie.
 *
 * @param {{ repositoryId?: number|null }} [options] one repository, or the fleet
 */
export async function dependencyInventory({ repositoryId = null } = {}) {
    // Scoped to one repository the enabled switch is the operator's, not a
    // filter: they opened that page. Across the fleet it is what every other
    // aggregate counts.
    const scope = repositoryId ? 'd.repository_id = @repositoryId' : 'r.enabled';

    return queryAll(
        `SELECT r.id AS repository_id, r.name AS repository_name, r.url AS repository_url,
                d.ecosystem, d.name, d.version, d.manifest_file,
                d.latest_version, d.latest_checked_at, d.latest_error
         FROM repository_dependencies d
         JOIN repositories r ON r.id = d.repository_id
         WHERE d.deleted_at IS NULL
           AND r.deleted_at IS NULL
           AND ${scope}
         ORDER BY r.name, d.ecosystem, d.name`,
        { repositoryId }
    );
}

/**
 * The repositories a report covers, with what the provider says they are built
 * with. Returned even when they hold no dependencies at all — a repository
 * nobody has scanned is the most important row on the page.
 *
 * @param {{ repositoryId?: number|null }} [options]
 */
export async function repositoryInventory({ repositoryId = null } = {}) {
    const scope = repositoryId ? 'id = @repositoryId' : 'enabled';

    return queryAll(
        `SELECT id, name, url, primary_language, languages, topics,
                last_scanned_at, enabled, archived
         FROM repositories
         WHERE deleted_at IS NULL
           AND ${scope}
         ORDER BY name`,
        { repositoryId }
    );
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
