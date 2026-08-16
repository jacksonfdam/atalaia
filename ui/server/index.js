import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
    COOKIE_NAME,
    parseCookies,
    requireSession,
    requireCsrfHeader,
    readToken,
    setSession,
    clearSession,
} from './session.js';
import { createProxy, callApi, API_BASE } from './proxy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, '..', 'dist');

const PORT = parseInt(process.env.UI_PORT, 10) || 3001;
const HOST = process.env.UI_HOST || '0.0.0.0';

/**
 * Sign-in throttling, per IP.
 *
 * It lives here rather than in the API because this is the only process that
 * knows who is calling: every request the API sees comes from this service, so
 * per-IP limiting there would count the whole console as one client.
 */
const attempts = new Map();
const MAX_ATTEMPTS = 10;
const LOCKOUT_MS = 15 * 60 * 1000;

/**
 * Exactly which paths the sign-in relay forwards.
 *
 * This relay cannot require a session — it is how a session comes to exist — so
 * it is the one place in the console that talks to the API on behalf of somebody
 * who has not proved anything. It therefore cannot be a prefix check.
 *
 * It was one, and `/auth/../organizations` walked straight out of it: the path
 * resolved back inside /api/v1, so the containment check let it through, and an
 * anonymous visitor got the organizations, the repositories and the owners with
 * the console's API key attached. A list of what this relay serves is the only
 * shape that cannot be walked out of.
 */
const UUID = '[0-9a-fA-F-]{36}';

const AUTH_ROUTES = [
    ['GET', /^\/state$/],
    ['GET', /^\/me$/],
    ['POST', /^\/registration\/(options|verify)$/],
    ['POST', /^\/authentication\/(options|verify)$/],
    ['POST', /^\/logout$/],
    ['GET', /^\/credentials$/],
    ['POST', /^\/credentials$/],
    ['PATCH', new RegExp(`^/credentials/${UUID}$`)],
    ['DELETE', new RegExp(`^/credentials/${UUID}$`)],
    ['POST', /^\/recovery\/(verify|codes)$/],
    ['GET', /^\/users$/],
    ['POST', new RegExp(`^/users/${UUID}/reset$`)],
    ['GET', /^\/invites$/],
    ['POST', /^\/invites$/],
    ['DELETE', new RegExp(`^/invites/${UUID}$`)],
];

/** @returns {boolean} whether this relay serves that method and path */
export function servesAuthRoute(method, path) {
    return AUTH_ROUTES.some(([verb, pattern]) => verb === method && pattern.test(path));
}

/** The ceremonies worth throttling: the ones that end in a session. */
const THROTTLED = new Set([
    '/authentication/verify',
    '/recovery/verify',
    '/registration/options',
    '/registration/verify',
]);

function throttle(ip) {
    const record = attempts.get(ip);
    if (!record) return { locked: false };

    if (Date.now() - record.first > LOCKOUT_MS) {
        attempts.delete(ip);
        return { locked: false };
    }

    return {
        locked: record.count >= MAX_ATTEMPTS,
        retryAfterMs: LOCKOUT_MS - (Date.now() - record.first),
    };
}

/** Exported for tests: the lockout is process-wide state shared across cases. */
export function resetThrottle() {
    attempts.clear();
}

function recordFailure(ip) {
    const record = attempts.get(ip) ?? { count: 0, first: Date.now() };
    record.count += 1;
    attempts.set(ip, record);
}

/**
 * What the page is allowed to load, and where it may talk.
 *
 * The bundle is served from this origin and the API is reached through this
 * origin, so almost everything is 'self'. The two exceptions are Google Fonts,
 * which index.html links — worth self-hosting, since it is a third party
 * learning the address of every console and every operator who opens one.
 *
 * `style-src` keeps 'unsafe-inline' because the console styles elements with
 * React's `style` prop, and a style attribute is inline style as far as the
 * policy is concerned. `script-src` does not, which is the half that matters.
 */
const CSP = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    'font-src https://fonts.gstatic.com',
    "img-src 'self' data:",
    "connect-src 'self'",
    "form-action 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'none'",
].join('; ');

export function createServer() {
    const app = express();

    app.disable('x-powered-by');

    // Off unless a deployment says otherwise, and that is the safe default: a
    // service that believes X-Forwarded-For without a proxy in front lets any
    // caller claim any address, which is the throttling below defeated in one
    // header. Behind a real proxy it has to be on, or every operator shares one
    // address and one of them failing locks out the rest.
    if (process.env.TRUST_PROXY) {
        app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : process.env.TRUST_PROXY);
    }

    app.use(express.json({ limit: '1mb' }));
    app.use(parseCookies);

    app.use((_req, res, next) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-Frame-Options', 'DENY');
        res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
        res.setHeader('Content-Security-Policy', CSP);
        // The console has no reason to reach for any of these, and saying so
        // stops a compromised dependency reaching for them either.
        res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
        next();
    });

    app.get('/healthz', (_req, res) => res.json({ status: 'ok', api: API_BASE }));

    /**
     * Whether this browser is signed in, and as whom.
     *
     * Answered by the API, because this service cannot tell: the cookie is an
     * opaque token and only the database knows whether the row behind it is
     * still live.
     */
    app.get('/auth/session', async (req, res) => {
        const token = readToken(req);
        if (!token) return res.json({ authenticated: false });

        try {
            const upstream = await callApi('/auth/me', { token });

            if (upstream.status !== 200) {
                clearSession(res);
                return res.json({ authenticated: false });
            }

            res.json({ authenticated: true, ...upstream.body });
        } catch (error) {
            res.status(502).json({ error: 'Atalaia API is unreachable', detail: error.message });
        }
    });

    /**
     * Everything else under /auth is relayed to the API as it stands.
     *
     * The one thing this service does to the exchange is the cookie: a reply
     * carrying a session token means a ceremony just succeeded, so the token
     * becomes an HttpOnly cookie here and is removed from the body. It never
     * reaches the page.
     */
    app.use('/auth', requireCsrfHeader, async (req, res) => {
        if (!servesAuthRoute(req.method, req.path)) {
            return res.status(404).json({ error: 'No such endpoint' });
        }

        const ip = req.ip ?? 'unknown';
        const throttled = THROTTLED.has(req.path);

        if (throttled) {
            const { locked, retryAfterMs } = throttle(ip);
            if (locked) {
                return res.status(429).json({
                    error: 'Too many attempts',
                    retryAfterSeconds: Math.ceil(retryAfterMs / 1000),
                });
            }
        }

        try {
            const upstream = await callApi(`/auth${req.path}`, {
                method: req.method,
                body: ['GET', 'HEAD'].includes(req.method) ? undefined : (req.body ?? {}),
                token: readToken(req),
            });

            if (throttled) {
                if (upstream.status === 401) recordFailure(ip);
                else if (upstream.status < 400) attempts.delete(ip);
            }

            const { token, ...body } = upstream.body ?? {};

            if (upstream.status < 400 && typeof token === 'string') {
                setSession(res, token, body.expiresAt);
            }

            if (req.path === '/logout') clearSession(res);

            res.status(upstream.status).json(body);
        } catch (error) {
            if (error.code === 'OUT_OF_BOUNDS') {
                return res.status(400).json({ error: error.message });
            }
            res.status(502).json({ error: 'Atalaia API is unreachable', detail: error.message });
        }
    });

    // Everything under /bff requires a session and is forwarded to the API.
    app.use('/bff', requireCsrfHeader, requireSession, createProxy());

    // Static bundle. Absent in dev, where Vite serves the client itself.
    if (fs.existsSync(DIST)) {
        app.use(express.static(DIST, { index: false }));
        app.get(/.*/, (_req, res) => res.sendFile(path.join(DIST, 'index.html')));
    }

    return app;
}

export { COOKIE_NAME };

// Only listen when executed directly, so tests can import createServer freely.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    createServer().listen(PORT, HOST, () => {
        console.log(`Atalaia Console on http://${HOST}:${PORT} → API ${API_BASE}`);
        if (!fs.existsSync(DIST)) {
            console.log('No client build found. Run `pnpm --filter atalaia-console build`, or `dev:client` for Vite.');
        }
    });
}
