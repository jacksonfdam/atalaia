import { readToken } from './session.js';

/**
 * Backend-for-frontend proxy.
 *
 * The browser never sees the Atalaia API key: it authenticates to this service
 * with a session cookie, and this service attaches the key on the way out. The
 * session token travels the same way — out of the cookie, into a header, server
 * to server — so the page holds no credential of any kind.
 */

const API_BASE = (process.env.ATALAIA_API_URL || 'http://localhost:3000').replace(/\/$/, '');
const TIMEOUT_MS = parseInt(process.env.BFF_TIMEOUT_MS, 10) || 120_000;

/** Everything this service is allowed to reach on the API. */
const PREFIX = '/api/v1';

/**
 * Resolve a path against the API, and refuse anything that leaves the REST
 * prefix.
 *
 * The browser controls this path, and `..` in it resolves before the request is
 * sent: `/bff/%2e%2e/%2e%2e/mcp` would have arrived at /mcp with the API key
 * attached, which is not what a console session is for. Resolving first and
 * checking the result — rather than pattern-matching the input — is what makes
 * the encoded spelling fail too.
 *
 * @param {string} path
 * @returns {URL}
 */
export function resolveTarget(path) {
    const target = new URL(`${API_BASE}${PREFIX}${path.startsWith('/') ? path : `/${path}`}`);
    const base = new URL(API_BASE);

    const contained =
        target.origin === base.origin &&
        (target.pathname === PREFIX || target.pathname.startsWith(`${PREFIX}/`));

    if (!contained) {
        const error = new Error('That path is outside the Atalaia API');
        error.code = 'OUT_OF_BOUNDS';
        throw error;
    }

    return target;
}

/**
 * One call to the API, with the console's credentials attached.
 *
 * @param {string} path  below /api/v1
 * @param {object} [options]
 * @param {string} [options.method]
 * @param {object} [options.body]
 * @param {string|null} [options.token]  the caller's session token
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{status: number, body: object, text: string, contentType: string}>}
 */
export async function callApi(path, { method = 'GET', body, token = null, signal } = {}) {
    const apiKey = process.env.API_KEY;
    if (!apiKey) throw new Error('API_KEY is not set');

    const target = resolveTarget(path);

    const headers = { 'X-API-Key': apiKey };
    if (token) headers['X-Session-Token'] = token;
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    const upstream = await fetch(target, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
    });

    const text = await upstream.text();
    let parsed = {};

    try {
        parsed = text ? JSON.parse(text) : {};
    } catch {
        parsed = {};
    }

    return {
        status: upstream.status,
        body: parsed,
        text,
        contentType: upstream.headers.get('content-type') ?? 'application/json',
    };
}

export function createProxy() {
    return async function proxy(req, res) {
        if (!process.env.API_KEY) {
            return res.status(500).json({ error: 'Console is misconfigured: API_KEY is not set' });
        }

        // A repository scan or a monitoring cycle can run for minutes; an abort
        // signal keeps a hung upstream from pinning a connection forever.
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

        try {
            const upstream = await callApi(req.url, {
                method: req.method,
                body: ['GET', 'HEAD'].includes(req.method) ? undefined : (req.body ?? {}),
                token: readToken(req),
                signal: controller.signal,
            });

            // Two different 401s arrive here and they mean opposite things. The
            // API refusing our *session* is an expired login and belongs to the
            // browser; the API refusing our *key* is a configuration problem
            // between two services, and mapping it to 401 would bounce the
            // operator to a sign-in screen that cannot help.
            if (upstream.status === 401 && upstream.body?.code !== 'session_required') {
                return res.status(502).json({
                    error: 'Atalaia API rejected the console API key',
                    hint: 'Check that API_KEY matches the value the API service is running with.',
                });
            }

            res.status(upstream.status);
            res.set('Content-Type', upstream.contentType);
            res.send(upstream.text);
        } catch (error) {
            if (error.code === 'OUT_OF_BOUNDS') {
                return res.status(400).json({ error: error.message });
            }

            const aborted = error.name === 'AbortError';
            res.status(aborted ? 504 : 502).json({
                error: aborted ? 'Atalaia API timed out' : 'Atalaia API is unreachable',
                detail: error.message,
                api: API_BASE,
            });
        } finally {
            clearTimeout(timer);
        }
    };
}

export { API_BASE };
