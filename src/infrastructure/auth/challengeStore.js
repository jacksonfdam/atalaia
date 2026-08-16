import { query, queryOne } from '../db/pool.js';
import { webauthnConfig } from './webauthnConfig.js';

/**
 * Challenges: issued here, consumed here, exactly once.
 *
 * A WebAuthn challenge is the whole of the replay protection. If the same one
 * can be presented twice, a captured assertion is a valid login for as long as
 * the attacker cares to reuse it — so the check cannot be "did we issue this",
 * it has to be "were we the ones to mark it used, just now".
 *
 * That is why consumption is a single UPDATE with the conditions in the WHERE
 * clause and no read beforehand. Two requests racing with the same challenge
 * both run it; Postgres serialises them on the row and exactly one gets a row
 * back. A SELECT-then-UPDATE would let both through.
 *
 * And why the row is in the database rather than in memory or in a cookie: a
 * restart, a second container, or a client that echoes back whatever it likes
 * would each defeat an in-process set.
 */

/**
 * @param {object} params
 * @param {string} params.challenge  base64url, as issued to the browser
 * @param {'registration'|'authentication'} params.ceremony
 * @param {string} [params.userId]
 */
export async function issueChallenge({ challenge, ceremony, userId = null }) {
    const { challengeTtlSeconds } = webauthnConfig();

    await query(
        `INSERT INTO webauthn_challenges (challenge, ceremony, user_id, expires_at)
         VALUES (@challenge, @ceremony, @userId, now() + (@ttl || ' seconds')::interval)`,
        {
            challenge: Buffer.from(challenge, 'base64url'),
            ceremony,
            userId,
            ttl: String(challengeTtlSeconds),
        }
    );
}

/**
 * Claim a challenge. Returns null if it was never issued, was issued for the
 * other ceremony, has already been used, or has expired — the caller cannot
 * tell which, and neither can anyone probing the endpoint.
 *
 * @param {object} params
 * @param {string} params.challenge  base64url, as echoed back by the browser
 * @param {'registration'|'authentication'} params.ceremony
 * @returns {Promise<{id: string, user_id: string|null}|null>}
 */
export async function consumeChallenge({ challenge, ceremony }) {
    if (typeof challenge !== 'string' || challenge.length === 0) return null;

    const row = await queryOne(
        `UPDATE webauthn_challenges
            SET consumed_at = now()
          WHERE challenge = @challenge
            AND ceremony = @ceremony
            AND consumed_at IS NULL
            AND expires_at > now()
      RETURNING id, user_id`,
        { challenge: Buffer.from(challenge, 'base64url'), ceremony }
    );

    return row ?? null;
}

/**
 * Drop challenges nobody can use any more.
 *
 * Consumed rows go too: the uniqueness that matters is enforced by consumed_at
 * within the lifetime, and a row past its expiry can no longer be claimed
 * whether it was used or not.
 *
 * @returns {Promise<number>} rows removed
 */
export async function sweepChallenges() {
    const result = await query('DELETE FROM webauthn_challenges WHERE expires_at < now()');
    return result.rowCount ?? 0;
}
