import { getDb } from './sqliteCache.js';
import { encrypt, decrypt, maskSecret, canEncrypt } from '../crypto.js';
import logger from '../logger.js';

const NOW = "datetime('now')";

/**
 * Persistence for source-code organizations.
 *
 * The token column is write-only from the outside: it goes in encrypted through
 * addOrganization/updateOrganization and comes back out only via
 * getOrganizationToken, which the importer and the scanner use. Everything the
 * API returns goes through present().
 */

/** Row shape safe to send over the wire. */
export function present(row) {
    if (!row) return null;

    return {
        id: row.id,
        key: row.key,
        login: row.login,
        name: row.name,
        provider: row.provider,
        enabled: row.enabled === 1,
        hasToken: Boolean(row.token_cipher),
        tokenHint: row.token_hint,
        lastImportAt: row.last_import_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        deletedAt: row.deleted_at,
    };
}

/**
 * @param {{ key: string, login: string, name?: string, provider?: string, token?: string }} data
 */
export function addOrganization({ key, login, name = null, provider = 'github', token = null }) {
    const cipher = token ? encrypt(token) : null;
    const hint = token ? maskSecret(token) : null;

    const result = getDb()
        .prepare(
            `INSERT INTO organizations (key, login, name, provider, token_cipher, token_hint)
             VALUES (@key, @login, @name, @provider, @cipher, @hint)
             ON CONFLICT(key) DO UPDATE SET
                login = excluded.login,
                name = excluded.name,
                provider = excluded.provider,
                -- Re-adding an organization without a token keeps the stored one.
                token_cipher = COALESCE(excluded.token_cipher, organizations.token_cipher),
                token_hint = COALESCE(excluded.token_hint, organizations.token_hint),
                updated_at = ${NOW},
                deleted_at = NULL
             RETURNING *`
        )
        .get({ key, login, name, provider, cipher, hint });

    logger.info({ key, login, id: result?.id }, 'Organization added/restored');
    return result ?? getOrganizationByKey(key);
}

export function getOrganizationByKey(key) {
    return getDb().prepare('SELECT * FROM organizations WHERE key = ?').get(key) || null;
}

export function getOrganization(id) {
    return getDb().prepare('SELECT * FROM organizations WHERE id = ?').get(id) || null;
}

export function listOrganizations({ includeDeleted = false } = {}) {
    const where = includeDeleted ? '' : 'WHERE deleted_at IS NULL';
    return getDb().prepare(`SELECT * FROM organizations ${where} ORDER BY key`).all();
}

/**
 * @param {string} key
 * @param {{ login?: string, name?: string, enabled?: boolean, token?: string|null, lastImportAt?: string }} updates
 */
export function updateOrganization(key, updates) {
    const fields = [];
    const values = { key };

    if (updates.login !== undefined) { fields.push('login = @login'); values.login = updates.login; }
    if (updates.name !== undefined) { fields.push('name = @name'); values.name = updates.name; }
    if (updates.enabled !== undefined) { fields.push('enabled = @enabled'); values.enabled = updates.enabled ? 1 : 0; }
    if (updates.lastImportAt !== undefined) { fields.push('last_import_at = @lastImportAt'); values.lastImportAt = updates.lastImportAt; }

    // An explicit null clears the token; undefined leaves it untouched.
    if (updates.token !== undefined) {
        fields.push('token_cipher = @cipher', 'token_hint = @hint');
        values.cipher = updates.token ? encrypt(updates.token) : null;
        values.hint = updates.token ? maskSecret(updates.token) : null;
    }

    if (fields.length === 0) return getOrganizationByKey(key);

    fields.push(`updated_at = ${NOW}`);
    getDb().prepare(`UPDATE organizations SET ${fields.join(', ')} WHERE key = @key`).run(values);

    return getOrganizationByKey(key);
}

/**
 * Soft-delete an organization and, with it, the repositories imported under it.
 * Leaving those behind would strand repositories nothing can authenticate to.
 *
 * @param {string} key
 * @returns {{ repositories: number }}
 */
export function softDeleteOrganization(key) {
    const db = getDb();
    let repositories = 0;

    db.transaction(() => {
        db.prepare(`UPDATE organizations SET deleted_at = ${NOW}, updated_at = ${NOW} WHERE key = ? AND deleted_at IS NULL`).run(key);

        const result = db
            .prepare(`UPDATE repositories SET deleted_at = ${NOW}, updated_at = ${NOW} WHERE org_key = ? AND deleted_at IS NULL`)
            .run(key);
        repositories = result.changes;

        db.prepare(
            `UPDATE repository_dependencies SET deleted_at = ${NOW}, updated_at = ${NOW}
             WHERE deleted_at IS NULL
               AND repository_id IN (SELECT id FROM repositories WHERE org_key = ?)`
        ).run(key);
    })();

    logger.info({ key, repositories }, 'Organization soft-deleted with its repositories');
    return { repositories };
}

/**
 * The decrypted token for an organization.
 * Only the importer and the scanner call this.
 *
 * @param {string} key
 * @returns {string|null}
 */
export function getOrganizationToken(key) {
    const row = getOrganizationByKey(key);
    if (!row?.token_cipher) return null;

    try {
        return decrypt(row.token_cipher);
    } catch (err) {
        logger.error({ key, err }, 'Failed to decrypt organization token');

        // Saying "wrong key" when there is no key at all sends the reader
        // hunting for a mismatch that does not exist.
        throw new Error(
            canEncrypt()
                ? `Cannot decrypt the token for "${key}". TOKEN_ENCRYPTION_KEY (or API_KEY) is not the one it was stored with.`
                : `Cannot decrypt the token for "${key}": neither TOKEN_ENCRYPTION_KEY nor API_KEY is set.`
        );
    }
}

/** How many repositories each organization currently has. */
export function countRepositoriesByOrg() {
    const rows = getDb()
        .prepare(
            `SELECT org_key AS key,
                    COUNT(*) AS total,
                    SUM(CASE WHEN enabled = 1 THEN 1 ELSE 0 END) AS enabled
             FROM repositories
             WHERE deleted_at IS NULL AND org_key IS NOT NULL
             GROUP BY org_key`
        )
        .all();

    return new Map(rows.map(row => [row.key, { total: row.total, enabled: row.enabled }]));
}
