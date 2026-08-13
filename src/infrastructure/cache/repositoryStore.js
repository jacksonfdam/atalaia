import { getDb } from './sqliteCache.js';
import logger from '../logger.js';

const NOW = "datetime('now')";

// ── Repositories ──

export function addRepository({
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
    const db = getDb();
    const stmt = db.prepare(`
        INSERT INTO repositories (
            name, url, provider, org_key, default_branch,
            primary_language, languages, topics, description, archived, enabled
        )
        VALUES (
            @name, @url, @provider, @orgKey, @defaultBranch,
            @primaryLanguage, @languages, @topics, @description, @archived, @enabled
        )
        ON CONFLICT(url) DO UPDATE SET
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
            updated_at = ${NOW},
            deleted_at = NULL
            -- The enabled column is intentionally absent: it is the operator's
            -- switch, and a re-import must not flip it back.
    `);
    const result = stmt.run({
        name,
        url,
        provider,
        orgKey,
        defaultBranch,
        primaryLanguage,
        languages: languages ? JSON.stringify(languages) : null,
        topics: topics ? JSON.stringify(topics) : null,
        description,
        archived: archived ? 1 : 0,
        enabled: enabled ? 1 : 0,
    });
    logger.info({ url, id: result.lastInsertRowid }, 'Repository added/restored');
    return getRepository(result.lastInsertRowid) || getRepositoryByUrl(url);
}

export function softDeleteRepository(id) {
    const db = getDb();
    const deleteRepo = db.prepare(`UPDATE repositories SET deleted_at = ${NOW}, updated_at = ${NOW} WHERE id = ? AND deleted_at IS NULL`);
    const deleteDeps = db.prepare(`UPDATE repository_dependencies SET deleted_at = ${NOW}, updated_at = ${NOW} WHERE repository_id = ? AND deleted_at IS NULL`);

    db.transaction(() => {
        deleteRepo.run(id);
        deleteDeps.run(id);
    })();

    logger.info({ id }, 'Repository soft-deleted with dependencies');
}

export function getRepository(id) {
    return getDb().prepare('SELECT * FROM repositories WHERE id = ?').get(id) || null;
}

export function getRepositoryByUrl(url) {
    return getDb().prepare('SELECT * FROM repositories WHERE url = ? AND deleted_at IS NULL').get(url) || null;
}

/**
 * Including the soft-deleted ones, which the importer needs: a repository the
 * operator removed must not come back on the next import.
 */
export function getAnyRepositoryByUrl(url) {
    return getDb().prepare('SELECT * FROM repositories WHERE url = ?').get(url) || null;
}

/** Restore a soft-deleted repository. */
export function restoreRepository(id) {
    const db = getDb();
    db.transaction(() => {
        db.prepare(`UPDATE repositories SET deleted_at = NULL, updated_at = ${NOW} WHERE id = ?`).run(id);
        db.prepare(
            `UPDATE repository_dependencies SET deleted_at = NULL, updated_at = ${NOW} WHERE repository_id = ?`
        ).run(id);
    })();
    logger.info({ id }, 'Repository restored');
    return getRepository(id);
}

export function listRepositories({ includeDeleted = false } = {}) {
    const where = includeDeleted ? '' : 'WHERE deleted_at IS NULL';
    return getDb().prepare(`SELECT * FROM repositories ${where} ORDER BY name`).all();
}

export function updateRepository(id, updates) {
    const fields = [];
    const values = { id };

    if (updates.name !== undefined) { fields.push('name = @name'); values.name = updates.name; }
    if (updates.enabled !== undefined) { fields.push('enabled = @enabled'); values.enabled = updates.enabled ? 1 : 0; }
    if (updates.lastScannedAt !== undefined) { fields.push('last_scanned_at = @lastScannedAt'); values.lastScannedAt = updates.lastScannedAt; }
    if (updates.defaultBranch !== undefined) { fields.push('default_branch = @defaultBranch'); values.defaultBranch = updates.defaultBranch; }
    if (updates.languages !== undefined) { fields.push('languages = @languages'); values.languages = updates.languages ? JSON.stringify(updates.languages) : null; }
    if (updates.primaryLanguage !== undefined) { fields.push('primary_language = @primaryLanguage'); values.primaryLanguage = updates.primaryLanguage; }
    if (updates.topics !== undefined) { fields.push('topics = @topics'); values.topics = updates.topics ? JSON.stringify(updates.topics) : null; }

    if (fields.length === 0) return;

    fields.push(`updated_at = ${NOW}`);
    const sql = `UPDATE repositories SET ${fields.join(', ')} WHERE id = @id`;
    getDb().prepare(sql).run(values);
}

// ── Dependencies ──

export function replaceDependencies(repoId, deps) {
    const db = getDb();

    db.transaction(() => {
        // Soft-delete all existing non-deleted deps for this repo
        db.prepare(`
            UPDATE repository_dependencies
            SET deleted_at = ${NOW}, updated_at = ${NOW}
            WHERE repository_id = ? AND deleted_at IS NULL
        `).run(repoId);

        // Upsert each dependency (restores soft-deleted ones if they match)
        const upsert = db.prepare(`
            INSERT INTO repository_dependencies
                (repository_id, ecosystem, name, version, manifest_file, opencve_vendor, opencve_product)
            VALUES (@repositoryId, @ecosystem, @name, @version, @manifestFile, @opencveVendor, @opencveProduct)
            ON CONFLICT(repository_id, ecosystem, name, manifest_file) DO UPDATE SET
                version = excluded.version,
                opencve_vendor = excluded.opencve_vendor,
                opencve_product = excluded.opencve_product,
                updated_at = ${NOW},
                deleted_at = NULL
        `);

        for (const dep of deps) {
            upsert.run({
                repositoryId: repoId,
                ecosystem: dep.ecosystem,
                name: dep.name,
                version: dep.version || null,
                manifestFile: dep.manifestFile || null,
                opencveVendor: dep.opencveVendor || null,
                opencveProduct: dep.opencveProduct || null,
            });
        }
    })();

    logger.info({ repoId, count: deps.length }, 'Dependencies replaced');
}

export function getDependenciesByRepo(repoId, { includeDeleted = false } = {}) {
    const where = includeDeleted
        ? 'WHERE repository_id = ?'
        : 'WHERE repository_id = ? AND deleted_at IS NULL';
    return getDb().prepare(`SELECT * FROM repository_dependencies ${where} ORDER BY ecosystem, name`).all(repoId);
}

export function findAffectedRepositories(vendor, product) {
    return getDb().prepare(`
        SELECT DISTINCT r.*
        FROM repositories r
        JOIN repository_dependencies d ON d.repository_id = r.id
        WHERE d.opencve_vendor = ? AND d.opencve_product = ?
          AND d.deleted_at IS NULL
          AND r.deleted_at IS NULL
          AND r.enabled = 1
    `).all(vendor, product);
}

/**
 * Find affected repos by dependency name (substring match against dep name).
 * Useful when we don't have vendor/product mapping but have a tech name.
 */
export function findAffectedRepositoriesByDepName(depName) {
    return getDb().prepare(`
        SELECT DISTINCT r.*
        FROM repositories r
        JOIN repository_dependencies d ON d.repository_id = r.id
        WHERE LOWER(d.name) = LOWER(?)
          AND d.deleted_at IS NULL
          AND r.deleted_at IS NULL
          AND r.enabled = 1
    `).all(depName);
}

// ── System Owners ──

export function addOwner({ name, email, slackUserId = null }) {
    const db = getDb();
    const stmt = db.prepare(`
        INSERT INTO system_owners (name, email, slack_user_id)
        VALUES (@name, @email, @slackUserId)
        ON CONFLICT(email) DO UPDATE SET
            name = excluded.name,
            slack_user_id = excluded.slack_user_id,
            updated_at = ${NOW},
            deleted_at = NULL
    `);
    const result = stmt.run({ name, email, slackUserId });
    logger.info({ email, id: result.lastInsertRowid }, 'Owner added/restored');
    return getOwner(result.lastInsertRowid) || getOwnerByEmail(email);
}

export function softDeleteOwner(id) {
    const db = getDb();
    db.transaction(() => {
        db.prepare(`UPDATE system_owners SET deleted_at = ${NOW}, updated_at = ${NOW} WHERE id = ? AND deleted_at IS NULL`).run(id);
        db.prepare(`UPDATE owner_assignments SET deleted_at = ${NOW} WHERE owner_id = ? AND deleted_at IS NULL`).run(id);
    })();
    logger.info({ id }, 'Owner soft-deleted with assignments');
}

export function getOwner(id) {
    return getDb().prepare('SELECT * FROM system_owners WHERE id = ? AND deleted_at IS NULL').get(id) || null;
}

export function getOwnerByEmail(email) {
    return getDb().prepare('SELECT * FROM system_owners WHERE email = ? AND deleted_at IS NULL').get(email) || null;
}

export function listOwners({ includeDeleted = false } = {}) {
    const where = includeDeleted ? '' : 'WHERE deleted_at IS NULL';
    return getDb().prepare(`SELECT * FROM system_owners ${where} ORDER BY name`).all();
}

export function updateOwner(id, updates) {
    const fields = [];
    const values = { id };

    if (updates.name !== undefined) { fields.push('name = @name'); values.name = updates.name; }
    if (updates.email !== undefined) { fields.push('email = @email'); values.email = updates.email; }
    if (updates.slackUserId !== undefined) { fields.push('slack_user_id = @slackUserId'); values.slackUserId = updates.slackUserId; }

    if (fields.length === 0) return;

    fields.push(`updated_at = ${NOW}`);
    getDb().prepare(`UPDATE system_owners SET ${fields.join(', ')} WHERE id = @id`).run(values);
}

// ── Owner Assignments ──

export function addAssignment({ ownerId, targetType, targetValue }) {
    const stmt = getDb().prepare(`
        INSERT INTO owner_assignments (owner_id, target_type, target_value)
        VALUES (@ownerId, @targetType, @targetValue)
        ON CONFLICT(owner_id, target_type, target_value) DO UPDATE SET
            deleted_at = NULL
    `);
    const result = stmt.run({ ownerId, targetType, targetValue });
    logger.info({ ownerId, targetType, targetValue }, 'Assignment added/restored');
    return getDb().prepare('SELECT * FROM owner_assignments WHERE id = ?').get(result.lastInsertRowid);
}

export function softDeleteAssignment(assignmentId) {
    getDb().prepare(`UPDATE owner_assignments SET deleted_at = ${NOW} WHERE id = ? AND deleted_at IS NULL`).run(assignmentId);
}

export function getAssignmentsByOwner(ownerId) {
    return getDb().prepare(
        'SELECT * FROM owner_assignments WHERE owner_id = ? AND deleted_at IS NULL ORDER BY target_type, target_value'
    ).all(ownerId);
}

/**
 * Find owners responsible for a vulnerability based on matching assignments.
 * Matches against ecosystem, dependency name, or repository URLs.
 */
export function findOwnersForVulnerability({ vendor, product, ecosystem, depNames = [], repoUrls = [] }) {
    const db = getDb();
    const conditions = [];
    const params = {};

    // Match by ecosystem assignment
    if (ecosystem) {
        conditions.push("(a.target_type = 'ecosystem' AND LOWER(a.target_value) = LOWER(@ecosystem))");
        params.ecosystem = ecosystem;
    }

    // Match by dependency name assignments
    for (let i = 0; i < depNames.length; i++) {
        conditions.push(`(a.target_type = 'dependency' AND LOWER(a.target_value) = LOWER(@dep${i}))`);
        params[`dep${i}`] = depNames[i];
    }

    // Match by repository URL assignments
    for (let i = 0; i < repoUrls.length; i++) {
        conditions.push(`(a.target_type = 'repository' AND a.target_value = @repo${i})`);
        params[`repo${i}`] = repoUrls[i];
    }

    if (conditions.length === 0) return [];

    const sql = `
        SELECT DISTINCT o.*
        FROM system_owners o
        JOIN owner_assignments a ON a.owner_id = o.id
        WHERE (${conditions.join(' OR ')})
          AND a.deleted_at IS NULL
          AND o.deleted_at IS NULL
    `;

    return db.prepare(sql).all(params);
}

// ── Vendor/Product Mappings ──

export function getVendorProductMapping(ecosystem, packageName) {
    const row = getDb().prepare(
        'SELECT opencve_vendor, opencve_product FROM vendor_product_mappings WHERE ecosystem = ? AND package_name = ?'
    ).get(ecosystem, packageName);
    return row ? { vendor: row.opencve_vendor, product: row.opencve_product } : null;
}

export function setVendorProductMapping(ecosystem, packageName, vendor, product) {
    getDb().prepare(`
        INSERT INTO vendor_product_mappings (ecosystem, package_name, opencve_vendor, opencve_product)
        VALUES (@ecosystem, @packageName, @vendor, @product)
        ON CONFLICT(ecosystem, package_name) DO UPDATE SET
            opencve_vendor = excluded.opencve_vendor,
            opencve_product = excluded.opencve_product,
            updated_at = ${NOW}
    `).run({ ecosystem, packageName, vendor, product });
}

export function getAllUniqueDependencies() {
    return getDb().prepare(`
        SELECT DISTINCT name, ecosystem, opencve_vendor, opencve_product
        FROM repository_dependencies
        WHERE deleted_at IS NULL
        ORDER BY ecosystem, name
    `).all();
}

/**
 * Seed vendor/product mappings from a JSON array.
 * @param {{ ecosystem: string, packageName: string, vendor: string, product: string }[]} mappings
 */
export function seedVendorProductMappings(mappings) {
    const db = getDb();
    const stmt = db.prepare(`
        INSERT INTO vendor_product_mappings (ecosystem, package_name, opencve_vendor, opencve_product)
        VALUES (@ecosystem, @packageName, @vendor, @product)
        ON CONFLICT(ecosystem, package_name) DO NOTHING
    `);

    db.transaction(() => {
        for (const m of mappings) {
            stmt.run(m);
        }
    })();

    logger.info({ count: mappings.length }, 'Seeded vendor/product mappings');
}
