import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { COOKIE_NAME, issue, cookieOptions, parseCookies, requireSession, verify } from './session.js';
import { createProxy, API_BASE } from './proxy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, '..', 'dist');

const PORT = parseInt(process.env.UI_PORT, 10) || 3001;
const HOST = process.env.UI_HOST || '0.0.0.0';

/** Login throttling, per IP. In-memory is enough for a single-instance console. */
const attempts = new Map();
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

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

function passwordMatches(candidate) {
    const expected = process.env.UI_PASSWORD;
    if (!expected) return false;

    // Hash both sides so the comparison is constant-time regardless of length.
    const a = crypto.createHash('sha256').update(String(candidate)).digest();
    const b = crypto.createHash('sha256').update(expected).digest();
    return crypto.timingSafeEqual(a, b);
}

export function createServer() {
    const app = express();

    app.disable('x-powered-by');
    app.use(express.json({ limit: '1mb' }));
    app.use(parseCookies);

    app.use((_req, res, next) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-Frame-Options', 'DENY');
        res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
        next();
    });

    app.get('/healthz', (_req, res) => res.json({ status: 'ok', api: API_BASE }));

    app.get('/auth/session', (req, res) => {
        res.json({ authenticated: verify(req.cookies?.[COOKIE_NAME]) });
    });

    app.post('/auth/login', (req, res) => {
        const ip = req.ip ?? 'unknown';
        const { locked, retryAfterMs } = throttle(ip);

        if (locked) {
            return res.status(429).json({
                error: 'Too many failed attempts',
                retryAfterSeconds: Math.ceil(retryAfterMs / 1000),
            });
        }

        if (!process.env.UI_PASSWORD) {
            return res.status(500).json({ error: 'Console is misconfigured: UI_PASSWORD is not set' });
        }

        if (!passwordMatches(req.body?.password ?? '')) {
            recordFailure(ip);
            return res.status(401).json({ error: 'Invalid password' });
        }

        attempts.delete(ip);
        res.cookie(COOKIE_NAME, issue(), cookieOptions());
        res.json({ authenticated: true });
    });

    app.post('/auth/logout', (_req, res) => {
        res.clearCookie(COOKIE_NAME, { ...cookieOptions(), maxAge: undefined });
        res.json({ authenticated: false });
    });

    // Everything under /bff requires a session and is forwarded to the API.
    app.use('/bff', requireSession, createProxy());

    // Static bundle. Absent in dev, where Vite serves the client itself.
    if (fs.existsSync(DIST)) {
        app.use(express.static(DIST, { index: false }));
        app.get(/.*/, (_req, res) => res.sendFile(path.join(DIST, 'index.html')));
    }

    return app;
}

// Only listen when executed directly, so tests can import createServer freely.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    if (!process.env.UI_SESSION_SECRET) {
        console.error('UI_SESSION_SECRET is not set. Generate one with: openssl rand -hex 32');
        process.exit(1);
    }

    createServer().listen(PORT, HOST, () => {
        console.log(`Atalaia Console on http://${HOST}:${PORT} → API ${API_BASE}`);
        if (!fs.existsSync(DIST)) {
            console.log('No client build found. Run `pnpm --filter atalaia-console build`, or `dev:client` for Vite.');
        }
    });
}
