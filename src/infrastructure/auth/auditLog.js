import { query } from '../db/pool.js';
import logger from '../logger.js';

/**
 * What happened, and to whom.
 *
 * An identity system that cannot answer that after the fact is one nobody can
 * trust once something goes wrong. Failures are recorded as well as successes —
 * the interesting pattern is usually in the failures.
 *
 * The one list of events. A name used in a route but absent here would be a
 * row nobody knows how to read.
 */
export const AUTH_EVENTS = {
    REGISTERED: 'credential.registered',
    SIGNED_IN: 'auth.succeeded',
    SIGN_IN_FAILED: 'auth.failed',
    COUNTER_REGRESSED: 'auth.counter_regressed',
    CREDENTIAL_DELETED: 'credential.deleted',
    RECOVERY_USED: 'recovery.used',
    RECOVERY_ISSUED: 'recovery.issued',
    BREAKGLASS_USED: 'auth.breakglass',
    BOOTSTRAPPED: 'auth.bootstrapped',
    INVITED: 'user.invited',
    SIGNED_OUT: 'auth.signed_out',
};

/**
 * The client's address, as far as it can be trusted.
 *
 * Express only believes X-Forwarded-For when trust proxy is set, which it is
 * not here — so this is the peer address. Behind the console's proxy that is
 * the console, which is honest: this service genuinely cannot see further.
 *
 * @param {import('express').Request} req
 */
export function clientIp(req) {
    const raw = req?.ip ?? null;
    if (!raw) return null;

    // Express reports IPv4 peers over a dual-stack socket as ::ffff:10.0.0.1,
    // which inet accepts but nobody wants to read.
    return raw.startsWith('::ffff:') ? raw.slice(7) : raw;
}

/**
 * @param {object} entry
 * @param {string} [entry.userId]
 * @param {string} entry.event      one of AUTH_EVENTS
 * @param {object} [entry.metadata]
 * @param {string} [entry.ip]
 */
export async function recordAuthEvent({ userId = null, event, metadata = {}, ip = null }) {
    try {
        await query(
            `INSERT INTO auth_audit_log (user_id, event, metadata, ip)
             VALUES (@userId, @event, @metadata::jsonb, @ip)`,
            { userId, event, metadata: JSON.stringify(metadata), ip }
        );
    } catch (err) {
        // Never the reason a sign-in fails. A missing audit row is a gap in the
        // record; a thrown error here would be a locked-out operator.
        logger.error({ err, event }, 'Could not write the auth audit entry');
    }
}
