/**
 * The browser's half of a session.
 *
 * This service holds a cookie and nothing else. The session itself is a row in
 * the API's database, and the cookie carries the opaque token that names it —
 * so signing out actually ends the session rather than clearing one copy of a
 * self-describing ticket, and there is no signing key here to keep secret or to
 * rotate.
 *
 * The token never reaches the page. It goes out again in a header, server to
 * server, on the way to the API.
 */

export const COOKIE_NAME = 'atalaia_console';

/**
 * A header no cross-origin form can set.
 *
 * The cookie is SameSite=Lax, which already stops a third-party page issuing a
 * POST with it attached. This is the second lock: a state-changing request that
 * did not come from the console's own JavaScript does not carry the header, and
 * a browser will not let a plain form add one.
 */
export const CSRF_HEADER = 'x-atalaia-console';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Cookie attributes. Secure is conditional so http://localhost still works. */
export function cookieOptions(maxAgeMs) {
    return {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        ...(maxAgeMs ? { maxAge: maxAgeMs } : {}),
    };
}

/** @returns {string|null} the session token this browser is carrying */
export function readToken(req) {
    const value = req.cookies?.[COOKIE_NAME];
    return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * @param {import('express').Response} res
 * @param {string} token
 * @param {string} [expiresAt] ISO timestamp from the API
 */
export function setSession(res, token, expiresAt) {
    const remaining = expiresAt ? new Date(expiresAt).getTime() - Date.now() : NaN;
    res.cookie(COOKIE_NAME, token, cookieOptions(Number.isFinite(remaining) && remaining > 0 ? remaining : undefined));
}

export function clearSession(res) {
    res.clearCookie(COOKIE_NAME, cookieOptions());
}

/** Express middleware: 401 unless the browser is carrying a session. */
export function requireSession(req, res, next) {
    if (readToken(req)) return next();
    res.status(401).json({ error: 'Not authenticated' });
}

/** Express middleware: reject a state-changing request that did not come from the console. */
export function requireCsrfHeader(req, res, next) {
    if (SAFE_METHODS.has(req.method)) return next();
    if (req.headers[CSRF_HEADER]) return next();

    res.status(403).json({ error: 'Missing console request header' });
}

/**
 * Minimal cookie parser. The console sets exactly one cookie, so pulling in a
 * dependency for this would be more surface area than the parsing is worth.
 */
export function parseCookies(req, _res, next) {
    const header = req.headers.cookie;
    req.cookies = {};

    if (header) {
        for (const part of header.split(';')) {
            const index = part.indexOf('=');
            if (index === -1) continue;
            const name = part.slice(0, index).trim();
            const value = part.slice(index + 1).trim();
            req.cookies[name] = decodeURIComponent(value);
        }
    }

    next();
}
