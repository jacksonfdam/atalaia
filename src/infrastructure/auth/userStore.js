import crypto from 'node:crypto';
import { query, queryOne, queryAll } from '../db/pool.js';

/**
 * Console accounts and the passkeys attached to them.
 *
 * A user is created before their first credential exists, because the WebAuthn
 * registration ceremony needs a handle to give the authenticator. A row with no
 * credentials cannot sign in — there is nothing to sign with — so the half-built
 * state is safe to leave behind if the ceremony is abandoned.
 */

/** 32 bytes, as the specification recommends. Not derived from anything. */
function newHandle() {
    return crypto.randomBytes(32);
}

/**
 * @param {object} params
 * @param {string} params.username
 * @param {string} params.displayName
 * @param {boolean} [params.isAdmin]
 * @param {import('pg').PoolClient} [client]
 */
export async function createUser({ username, displayName, isAdmin = false }, client = null) {
    return await queryOne(
        `INSERT INTO users (handle, username, display_name, is_admin)
         VALUES (@handle, @username, @displayName, @isAdmin)
         RETURNING *`,
        { handle: newHandle(), username, displayName, isAdmin },
        client
    );
}

export async function findUserById(id) {
    if (!id) return null;
    return await queryOne('SELECT * FROM users WHERE id = @id', { id });
}

/** Case-insensitive, matching the unique index. */
export async function findUserByUsername(username) {
    if (typeof username !== 'string' || username.length === 0) return null;
    return await queryOne('SELECT * FROM users WHERE lower(username) = lower(@username)', {
        username,
    });
}

export async function countUsers() {
    const row = await queryOne('SELECT count(*)::int AS n FROM users');
    return row?.n ?? 0;
}

export async function listUsers() {
    return await queryAll(
        `SELECT u.id, u.username, u.display_name, u.is_admin, u.created_at, u.disabled_at,
                count(c.id)::int AS credential_count
           FROM users u
           LEFT JOIN webauthn_credentials c ON c.user_id = u.id
          GROUP BY u.id
          ORDER BY u.created_at`
    );
}

export async function setUserDisabled(id, disabled) {
    return await queryOne(
        `UPDATE users SET disabled_at = CASE WHEN @disabled THEN now() ELSE NULL END
          WHERE id = @id RETURNING *`,
        { id, disabled }
    );
}

/**
 * @param {object} credential  as returned by verifyRegistration()
 * @param {string} userId
 * @param {string|null} nickname
 * @param {import('pg').PoolClient} [client]
 */
export async function addCredential({ userId, credential, nickname = null }, client = null) {
    return await queryOne(
        `INSERT INTO webauthn_credentials
             (user_id, credential_id, public_key, sign_count, transports, aaguid,
              backup_eligible, backup_state, nickname)
         VALUES (@userId, @credentialId, @publicKey, @counter, @transports, @aaguid,
                 @backupEligible, @backupState, @nickname)
         RETURNING *`,
        {
            userId,
            credentialId: credential.credentialId,
            publicKey: credential.publicKey,
            counter: credential.counter,
            transports: credential.transports ?? [],
            aaguid: credential.aaguid,
            backupEligible: credential.backupEligible,
            backupState: credential.backupState,
            nickname,
        },
        client
    );
}

export async function listCredentials(userId) {
    return await queryAll(
        `SELECT * FROM webauthn_credentials WHERE user_id = @userId ORDER BY created_at`,
        { userId }
    );
}

export async function countCredentials(userId) {
    const row = await queryOne(
        'SELECT count(*)::int AS n FROM webauthn_credentials WHERE user_id = @userId',
        { userId }
    );
    return row?.n ?? 0;
}

/**
 * The credential the assertion claims to be, together with its owner.
 *
 * One query rather than two, because every caller needs both and a credential
 * whose user has been disabled must not authenticate.
 *
 * @param {Buffer} credentialId  raw bytes
 */
export async function findCredentialWithUser(credentialId) {
    return await queryOne(
        `SELECT c.*, u.id AS user_id, u.username, u.display_name, u.is_admin, u.disabled_at
           FROM webauthn_credentials c
           JOIN users u ON u.id = c.user_id
          WHERE c.credential_id = @credentialId`,
        { credentialId }
    );
}

/**
 * Record a successful use. The counter and the backup flags both move: a
 * passkey that has just been synced to a new device reports it here and
 * nowhere else.
 */
export async function markCredentialUsed({ id, counter, backupState, backupEligible }) {
    await query(
        `UPDATE webauthn_credentials
            SET sign_count = @counter,
                backup_state = @backupState,
                backup_eligible = @backupEligible,
                last_used_at = now()
          WHERE id = @id`,
        { id, counter, backupState, backupEligible }
    );
}

/** Scoped by user, so an id from somebody else's account matches nothing. */
export async function deleteCredential({ id, userId }) {
    const row = await queryOne(
        'DELETE FROM webauthn_credentials WHERE id = @id AND user_id = @userId RETURNING id',
        { id, userId }
    );
    return Boolean(row);
}

export async function renameCredential({ id, userId, nickname }) {
    return await queryOne(
        `UPDATE webauthn_credentials SET nickname = @nickname
          WHERE id = @id AND user_id = @userId RETURNING *`,
        { id, userId, nickname }
    );
}
