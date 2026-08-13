import crypto from 'node:crypto';

/**
 * Signed session cookies without a session store.
 *
 * The console has exactly one identity (a shared password), so there is no
 * server-side state worth keeping — the cookie carries its own expiry and an
 * HMAC over it. That keeps the service stateless and restart-safe.
 */

export const COOKIE_NAME = 'atalaia_console';
const DEFAULT_TTL_MS = 12 * 60 * 60 * 1000;

function secret() {
    const value = process.env.UI_SESSION_SECRET;
    if (!value) {
        throw new Error('UI_SESSION_SECRET is not set — refusing to issue unsigned sessions');
    }
    return value;
}

function sign(payload) {
    return crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
}

/**
 * @param {number} [ttlMs]
 * @returns {string} cookie value
 */
export function issue(ttlMs = DEFAULT_TTL_MS) {
    // A random id makes two sessions issued in the same millisecond distinct,
    // so one cookie can be reasoned about independently of another.
    const payload = `${crypto.randomBytes(9).toString('base64url')}.${Date.now() + ttlMs}`;
    return `${payload}.${sign(payload)}`;
}

/**
 * @param {string|undefined} cookieValue
 * @returns {boolean}
 */
export function verify(cookieValue) {
    if (!cookieValue) return false;

    const parts = cookieValue.split('.');
    if (parts.length !== 3) return false;

    const [id, expiry, signature] = parts;
    const expected = sign(`${id}.${expiry}`);

    const given = Buffer.from(signature);
    const want = Buffer.from(expected);
    // Length check first: timingSafeEqual throws on a length mismatch.
    if (given.length !== want.length) return false;
    if (!crypto.timingSafeEqual(given, want)) return false;

    const expiresAt = Number(expiry);
    return Number.isFinite(expiresAt) && expiresAt > Date.now();
}

/** Cookie attributes. Secure is conditional so http://localhost still works. */
export function cookieOptions() {
    return {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: DEFAULT_TTL_MS,
        path: '/',
    };
}

/** Express middleware: 401 unless a valid session cookie is present. */
export function requireSession(req, res, next) {
    if (verify(req.cookies?.[COOKIE_NAME])) return next();
    res.status(401).json({ error: 'Not authenticated' });
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
