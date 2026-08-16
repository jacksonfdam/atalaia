import crypto from 'node:crypto';
import { queryAll, queryOne } from '../db/pool.js';

/**
 * How an account comes to exist after the first one.
 *
 * Registration is not open — it cannot be, because a passkey proves possession
 * of an authenticator and nothing about who is allowed in. So an admin names
 * the account up front and hands over a token; the invitee's ceremony fills in
 * the credential.
 *
 * The token is stored hashed for the same reason a session is: the row is not
 * the secret.
 */

const DEFAULT_TTL_HOURS = 72;

function hash(token) {
    return crypto.createHash('sha256').update(token).digest();
}

/**
 * @param {object} params
 * @param {string} params.username
 * @param {string} params.displayName
 * @param {boolean} [params.isAdmin]
 * @param {string} params.invitedBy
 * @param {number} [params.ttlHours]
 * @returns {Promise<{token: string, invite: object}>}
 */
export async function createInvite({
    username,
    displayName,
    isAdmin = false,
    invitedBy,
    ttlHours = DEFAULT_TTL_HOURS,
}) {
    const token = crypto.randomBytes(32).toString('base64url');

    const invite = await queryOne(
        `INSERT INTO user_invites (token_hash, username, display_name, is_admin, invited_by, expires_at)
         VALUES (@tokenHash, @username, @displayName, @isAdmin, @invitedBy,
                 now() + (@ttl || ' hours')::interval)
         RETURNING id, username, display_name, is_admin, expires_at, created_at`,
        {
            tokenHash: hash(token),
            username,
            displayName,
            isAdmin,
            invitedBy,
            ttl: String(ttlHours),
        }
    );

    return { token, invite };
}

/**
 * Claim an invite. Single-use and time-limited, both enforced in the statement
 * that claims it, so two people holding the same token cannot both register.
 *
 * @param {string} token
 * @returns {Promise<object|null>}
 */
export async function consumeInvite(token) {
    if (typeof token !== 'string' || token.length === 0) return null;

    return await queryOne(
        `UPDATE user_invites SET accepted_at = now()
          WHERE token_hash = @tokenHash AND accepted_at IS NULL AND expires_at > now()
      RETURNING id, username, display_name, is_admin`,
        { tokenHash: hash(token) }
    );
}

/** Outstanding invitations, for the console to show and an admin to chase. */
export async function listInvites() {
    return await queryAll(
        `SELECT id, username, display_name, is_admin, expires_at, accepted_at, created_at
           FROM user_invites
          WHERE accepted_at IS NULL AND expires_at > now()
          ORDER BY created_at DESC`
    );
}

export async function revokeInvite(id) {
    const row = await queryOne(
        `DELETE FROM user_invites WHERE id = @id AND accepted_at IS NULL RETURNING id`,
        { id }
    );
    return Boolean(row);
}
