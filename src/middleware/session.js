import { resolveSession, SCOPES } from '../infrastructure/auth/sessionStore.js';

/**
 * Who is making this request.
 *
 * The console's browser holds a cookie; this service never sees it. The console
 * exchanges that cookie for the opaque token it was issued and sends it here in
 * X-Session-Token, so the session is validated once, against the database, in
 * the process that owns the database.
 *
 * The API key remains what it always was: the machine credential, used by the
 * CLI and by agents over MCP. It says which *program* is calling, not which
 * person. A request that carries a session token is a person, and it is checked
 * as one.
 */

export const SESSION_HEADER = 'x-session-token';

function tokenFrom(req) {
    const value = req.headers[SESSION_HEADER];
    return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Resolve the session if one was sent, without deciding anything about it.
 * Leaves `req.session` and `req.user` null for a machine client.
 */
export async function attachSession(req, _res, next) {
    // Idempotent: the API router attaches once for everything under /api/v1,
    // and the auth router attaches for its own sake so it also works mounted on
    // its own. Resolving twice would be two lookups for one request.
    if (req.session !== undefined) return next();

    req.session = null;
    req.user = null;

    const token = tokenFrom(req);
    if (!token) return next();

    try {
        const resolved = await resolveSession(token);
        if (resolved) {
            req.session = resolved.session;
            req.user = resolved.user;
        }
    } catch (err) {
        return next(err);
    }

    next();
}

/**
 * The gate on everything the console reaches.
 *
 * A request with no session token at all is a machine client and passes: it has
 * already presented the API key. A request that *claims* a session must have a
 * real one — an expired or revoked token is a rejection, never a downgrade to
 * machine access.
 */
export async function requireSessionIfPresent(req, res, next) {
    const token = tokenFrom(req);
    if (!token) return next();

    if (!req.session) {
        return res.status(401).json({ error: 'Session expired', code: 'session_required' });
    }

    if (req.session.scope !== SCOPES.FULL) {
        return res.status(403).json({
            error: 'This session may only enroll a passkey',
            code: 'recovery_session',
        });
    }

    next();
}

/** For routes that are about a person and make no sense without one. */
export function requireUser(req, res, next) {
    if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated', code: 'session_required' });
    }
    next();
}

/** Enrolling a passkey is the one thing a recovery session is allowed to do. */
export function requireFullSession(req, res, next) {
    if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated', code: 'session_required' });
    }
    if (req.session.scope !== SCOPES.FULL) {
        return res.status(403).json({
            error: 'This session may only enroll a passkey',
            code: 'recovery_session',
        });
    }
    next();
}

export function requireAdmin(req, res, next) {
    if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated', code: 'session_required' });
    }
    if (req.session.scope !== SCOPES.FULL || !req.user.isAdmin) {
        return res.status(403).json({ error: 'Administrator access required' });
    }
    next();
}
