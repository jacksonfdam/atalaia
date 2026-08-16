/**
 * What the console's server does with a request.
 *
 * Three things, and they are the whole of its job: the Atalaia API key never
 * reaches the browser, the session token never reaches the page, and a request
 * that arrives without either is refused before it costs an upstream call.
 */
import { describe, test, expect, beforeAll, beforeEach, afterAll, jest } from '@jest/globals';
import request from 'supertest';

process.env.API_KEY = 'super-secret-api-key';
process.env.ATALAIA_API_URL = 'http://atalaia-api.test';

const { createServer, resetThrottle } = await import('../../../ui/server/index.js');
const { COOKIE_NAME } = await import('../../../ui/server/session.js');

const realFetch = globalThis.fetch;
const CONSOLE = { 'X-Atalaia-Console': '1' };

let app;
let lastRequest;

/** Reply as the API would, for whatever this test is exercising. */
function upstream(body, status = 200) {
    globalThis.fetch = jest.fn(async (url, options) => {
        lastRequest = { url, options };
        return new Response(JSON.stringify(body), {
            status,
            headers: { 'Content-Type': 'application/json' },
        });
    });
}

/** An agent holding a session cookie, without going through a ceremony. */
function signedIn() {
    return request.agent(app).set('Cookie', [`${COOKIE_NAME}=an-opaque-token`]);
}

beforeAll(() => {
    app = createServer();
});

beforeEach(() => {
    // The lockout counter is module-level state; without this it would 429
    // every case that runs after the throttling test.
    resetThrottle();
    lastRequest = null;
    upstream({ total: 3 });
});

afterAll(() => {
    globalThis.fetch = realFetch;
});

describe('the session endpoint', () => {
    test('reports an anonymous visitor without asking the API', async () => {
        const res = await request(app).get('/auth/session');

        expect(res.body).toEqual({ authenticated: false });
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    test('asks the API who the cookie belongs to', async () => {
        upstream({ user: { username: 'jackson' }, credentialCount: 2 });

        const res = await signedIn().get('/auth/session');

        expect(lastRequest.url).toBe('http://atalaia-api.test/api/v1/auth/me');
        expect(lastRequest.options.headers['X-Session-Token']).toBe('an-opaque-token');
        expect(res.body).toMatchObject({ authenticated: true, credentialCount: 2 });
    });

    test('clears a cookie the API no longer recognises', async () => {
        upstream({ error: 'Session expired' }, 401);

        const res = await signedIn().get('/auth/session');

        expect(res.body.authenticated).toBe(false);
        expect(res.headers['set-cookie'][0]).toMatch(new RegExp(`${COOKIE_NAME}=;`));
    });
});

describe('a completed ceremony', () => {
    test('becomes an HttpOnly cookie, and the token leaves the reply', async () => {
        upstream({
            verified: true,
            token: 'a-brand-new-session-token',
            expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
            user: { username: 'jackson' },
        });

        const res = await request(app)
            .post('/auth/authentication/verify')
            .set(CONSOLE)
            .send({ response: {} });

        expect(res.status).toBe(200);
        expect(res.body).not.toHaveProperty('token');
        expect(JSON.stringify(res.body)).not.toContain('a-brand-new-session-token');

        const cookie = res.headers['set-cookie'][0];
        expect(cookie).toContain('a-brand-new-session-token');
        expect(cookie).toMatch(/HttpOnly/i);
        expect(cookie).toMatch(/SameSite=Lax/i);
    });

    test('is refused without the console header', async () => {
        const res = await request(app).post('/auth/authentication/verify').send({ response: {} });

        expect(res.status).toBe(403);
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    test('locks out an address that keeps failing', async () => {
        upstream({ error: 'Authentication failed' }, 401);

        for (let attempt = 0; attempt < 10; attempt += 1) {
            await request(app).post('/auth/authentication/verify').set(CONSOLE).send({});
        }

        const res = await request(app).post('/auth/authentication/verify').set(CONSOLE).send({});
        expect(res.status).toBe(429);
        expect(res.body.retryAfterSeconds).toBeGreaterThan(0);
    });
});

describe('the proxy', () => {
    test('refuses an unauthenticated call before it costs an upstream request', async () => {
        const res = await request(app).get('/bff/stats');

        expect(res.status).toBe(401);
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    test('attaches the API key and the session token', async () => {
        const res = await signedIn().get('/bff/stats');

        expect(res.status).toBe(200);
        expect(lastRequest.url).toBe('http://atalaia-api.test/api/v1/stats');
        expect(lastRequest.options.headers['X-API-Key']).toBe('super-secret-api-key');
        expect(lastRequest.options.headers['X-Session-Token']).toBe('an-opaque-token');
    });

    test('never leaks the API key to the browser', async () => {
        const res = await signedIn().get('/bff/stats');

        const exposed = JSON.stringify({ body: res.body, headers: res.headers });
        expect(exposed).not.toContain('super-secret-api-key');
    });

    test('preserves query strings when forwarding', async () => {
        await signedIn().get('/bff/vulnerabilities?severity=CRITICAL&limit=10');

        expect(lastRequest.url).toBe(
            'http://atalaia-api.test/api/v1/vulnerabilities?severity=CRITICAL&limit=10'
        );
    });

    test('forwards a JSON body on writes', async () => {
        await signedIn().patch('/bff/vulnerabilities/CVE-1/status').set(CONSOLE).send({ status: 'RESOLVED' });

        expect(lastRequest.options.method).toBe('PATCH');
        expect(JSON.parse(lastRequest.options.body)).toEqual({ status: 'RESOLVED' });
    });

    test('refuses a write without the console header', async () => {
        const res = await signedIn().patch('/bff/vulnerabilities/CVE-1/status').send({ status: 'RESOLVED' });

        expect(res.status).toBe(403);
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    test('passes an expired session back to the browser as a 401', async () => {
        upstream({ error: 'Session expired', code: 'session_required' }, 401);

        const res = await signedIn().get('/bff/stats');
        expect(res.status).toBe(401);
    });

    test('maps a rejected API key to 502, so the operator is not bounced to sign-in', async () => {
        upstream({ error: 'Unauthorized' }, 401);

        const res = await signedIn().get('/bff/stats');
        expect(res.status).toBe(502);
        expect(res.body.error).toMatch(/rejected the console API key/i);
    });

    test('reports an unreachable API as 502', async () => {
        globalThis.fetch = jest.fn(async () => {
            throw new Error('ECONNREFUSED');
        });

        const res = await signedIn().get('/bff/stats');
        expect(res.status).toBe(502);
        expect(res.body.error).toMatch(/unreachable/i);
    });

    test('passes an upstream error status through unchanged', async () => {
        upstream({ error: 'Not found' }, 404);

        const res = await signedIn().get('/bff/vulnerabilities/CVE-0');
        expect(res.status).toBe(404);
    });

    test('signing out clears the cookie', async () => {
        upstream({ authenticated: false });

        const res = await signedIn().post('/auth/logout').set(CONSOLE);

        expect(res.headers['set-cookie'][0]).toMatch(new RegExp(`${COOKIE_NAME}=;`));
    });
});
