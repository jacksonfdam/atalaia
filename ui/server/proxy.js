/**
 * Backend-for-frontend proxy.
 *
 * The browser never sees the Atalaia API key: it authenticates to this service
 * with a session cookie, and this service attaches the key on the way out.
 */

const API_BASE = (process.env.ATALAIA_API_URL || 'http://localhost:3000').replace(/\/$/, '');
const TIMEOUT_MS = parseInt(process.env.BFF_TIMEOUT_MS, 10) || 120_000;

export function createProxy() {
    return async function proxy(req, res) {
        const apiKey = process.env.API_KEY;
        if (!apiKey) {
            return res.status(500).json({ error: 'Console is misconfigured: API_KEY is not set' });
        }

        const target = `${API_BASE}/api/v1${req.url}`;
        const headers = { 'X-API-Key': apiKey };
        let body;

        if (!['GET', 'HEAD'].includes(req.method)) {
            headers['Content-Type'] = 'application/json';
            body = JSON.stringify(req.body ?? {});
        }

        // A repository scan or a monitoring cycle can run for minutes; an abort
        // signal keeps a hung upstream from pinning a connection forever.
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

        try {
            const upstream = await fetch(target, {
                method: req.method,
                headers,
                body,
                signal: controller.signal,
            });

            const text = await upstream.text();

            // The API rejecting our key is an upstream configuration problem,
            // not an expired browser session. Mapping it to 401 would bounce
            // the operator to the login screen and hide the real cause.
            if (upstream.status === 401) {
                return res.status(502).json({
                    error: 'Atalaia API rejected the console API key',
                    hint: 'Check that API_KEY matches the value the API service is running with.',
                });
            }

            res.status(upstream.status);
            res.set('Content-Type', upstream.headers.get('content-type') ?? 'application/json');
            res.send(text);
        } catch (error) {
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
