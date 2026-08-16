import crypto from 'node:crypto';
import { query, queryOne } from '../db/pool.js';
import { webauthnConfig } from './webauthnConfig.js';

/**
 * Sessions, server-side.
 *
 * The console used to carry a self-describing cookie signed with an HMAC: no
 * row anywhere, so nothing to revoke. Signing out cleared the cookie in one
 * browser and left every copy of it valid until it expired, and the only way to
 * end a session early was to rotate the signing key and log everybody out.
 *
 * Now the cookie is an opaque random token and the row is the session. Only the
 * SHA-256 of the token is stored, so a dump of this table is not a set of
 * usable sessions.
 *
 * The lookup is an index probe on that hash rather than a constant-time
 * comparison of the token itself. What the comparison sees is a digest, not the
 * secret: timing can at most narrow down digest bytes, and there is no way back
 * from those to the token.
 */

/** Only a passkey may be enrolled with a recovery session. Nothing else. */
export const SCOPES = { FULL: 'full', RECOVERY: 'recovery' };

/** A recovery session is a means to enroll, not a working day. Minutes, not weeks. */
const RECOVERY_TTL_MINUTES = 15;

/** How stale last_seen_at is allowed to get before a request writes it back. */
const TOUCH_AFTER_MS = 60_000;

function hash(token) {
    return crypto.createHash('sha256').update(token).digest();
}

/**
 * @param {object} params
 * @param {string} params.userId
 * @param {'full'|'recovery'} [params.scope]
 * @param {string} [params.userAgent]
 * @returns {Promise<{token: string, session: object}>}
 */
export async function createSession({ userId, scope = SCOPES.FULL, userAgent = null }) {
    const { sessionTtlHours } = webauthnConfig();

    const token = crypto.randomBytes(32).toString('base64url');

    const lifetime =
        scope === SCOPES.RECOVERY
            ? `${RECOVERY_TTL_MINUTES} minutes`
            : `${sessionTtlHours} hours`;

    const session = await queryOne(
        `INSERT INTO sessions (user_id, token_hash, scope, expires_at, user_agent)
         VALUES (@userId, @tokenHash, @scope, now() + @lifetime::interval, @userAgent)
         RETURNING id, user_id, scope, created_at, expires_at`,
        {
            userId,
            tokenHash: hash(token),
            scope,
            lifetime,
            // Truncated: this is for a human recognising a session in a list,
            // not for fingerprinting, and some clients send a paragraph.
            userAgent: userAgent ? String(userAgent).slice(0, 300) : null,
        }
    );

    return { token, session };
}

/**
 * The live session behind a token, with its user. Null for anything else —
 * unknown, revoked, expired, or belonging to a disabled account.
 *
 * @param {string} token
 * @returns {Promise<{session: object, user: object}|null>}
 */
export async function resolveSession(token) {
    if (typeof token !== 'string' || token.length === 0) return null;

    const row = await queryOne(
        `SELECT s.id, s.user_id, s.scope, s.expires_at, s.last_seen_at,
                u.username, u.display_name, u.is_admin, u.disabled_at
           FROM sessions s
           JOIN users u ON u.id = s.user_id
          WHERE s.token_hash = @tokenHash
            AND s.revoked_at IS NULL
            AND s.expires_at > now()
            AND u.disabled_at IS NULL`,
        { tokenHash: hash(token) }
    );

    if (!row) return null;

    // Written back only when it has drifted, so a busy console is not one
    // UPDATE per request for a column nobody reads that precisely.
    const lastSeen = new Date(row.last_seen_at).getTime();
    if (Number.isFinite(lastSeen) && Date.now() - lastSeen > TOUCH_AFTER_MS) {
        await query('UPDATE sessions SET last_seen_at = now() WHERE id = @id', { id: row.id });
    }

    return {
        session: {
            id: row.id,
            scope: row.scope,
            expiresAt: row.expires_at,
        },
        user: {
            id: row.user_id,
            username: row.username,
            displayName: row.display_name,
            isAdmin: row.is_admin,
        },
    };
}

/**
 * End a session. Revoking the row rather than clearing the cookie is the point:
 * a copy of the cookie taken beforehand stops working too.
 *
 * @returns {Promise<boolean>} whether there was a live session to revoke
 */
export async function revokeSession(token) {
    if (typeof token !== 'string' || token.length === 0) return false;

    const row = await queryOne(
        `UPDATE sessions SET revoked_at = now()
          WHERE token_hash = @tokenHash AND revoked_at IS NULL
      RETURNING id`,
        { tokenHash: hash(token) }
    );

    return Boolean(row);
}

/** Every session this user has, everywhere. Used when their credentials change. */
export async function revokeAllSessions(userId) {
    const result = await query(
        'UPDATE sessions SET revoked_at = now() WHERE user_id = @userId AND revoked_at IS NULL',
        { userId }
    );
    return result.rowCount ?? 0;
}

/**
 * Remove sessions that can no longer authenticate anyone.
 *
 * Revoked rows are kept for a week rather than deleted at once: "this token was
 * revoked on Tuesday" is the answer to a question somebody asks after an
 * incident, and it costs one row.
 *
 * @returns {Promise<number>}
 */
export async function sweepSessions() {
    const result = await query(
        `DELETE FROM sessions
          WHERE expires_at < now() - interval '7 days'
             OR revoked_at < now() - interval '7 days'`
    );
    return result.rowCount ?? 0;
}
