/**
 * BFF behaviour: authentication gating, login throttling, and the guarantee
 * that the Atalaia API key never reaches the browser.
 */
import { describe, test, expect, beforeAll, beforeEach, jest } from '@jest/globals';
import request from 'supertest';

process.env.UI_SESSION_SECRET = 'test-secret-not-a-real-key';
process.env.UI_PASSWORD = 'correct-horse';
process.env.API_KEY = 'super-secret-api-key';
process.env.ATALAIA_API_URL = 'http://atalaia-api.test';

const { createServer, resetThrottle } = await import('../../../ui/server/index.js');

const realFetch = globalThis.fetch;
let app;
let lastRequest;

beforeAll(() => {
    app = createServer();
});

beforeEach(() => {
    // The lockout counter is module-level state; without this the lockout test
    // would 429 every case that runs after it.
    resetThrottle();
    lastRequest = null;
    globalThis.fetch = jest.fn(async (url, options) => {
        lastRequest = { url, options };
        return new Response(JSON.stringify({ total: 3 }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    });
});

afterAll(() => {
    globalThis.fetch = realFetch;
});

async function login(agent) {
    const res = await agent.post('/auth/login').send({ password: 'correct-horse' });
    expect(res.status).toBe(200);
    return agent;
}

describe('authentication', () => {
    test('reports an anonymous visitor as unauthenticated', async () => {
        const res = await request(app).get('/auth/session');
        expect(res.body.authenticated).toBe(false);
    });

    test('rejects the wrong password', async () => {
        const res = await request(app).post('/auth/login').send({ password: 'wrong' });
        expect(res.status).toBe(401);
    });

    test('rejects an empty password', async () => {
        const res = await request(app).post('/auth/login').send({});
        expect(res.status).toBe(401);
    });

    test('accepts the right password and sets an HttpOnly cookie', async () => {
        const res = await request(app).post('/auth/login').send({ password: 'correct-horse' });

        expect(res.status).toBe(200);
        const cookie = res.headers['set-cookie'][0];
        expect(cookie).toMatch(/HttpOnly/i);
        expect(cookie).toMatch(/SameSite=Lax/i);
    });

    test('locks out after repeated failures', async () => {
        const agent = request.agent(app);
        for (let attempt = 0; attempt < 5; attempt += 1) {
            await agent.post('/auth/login').send({ password: `wrong-${attempt}` });
        }

        const res = await agent.post('/auth/login').send({ password: 'correct-horse' });
        expect(res.status).toBe(429);
        expect(res.body.retryAfterSeconds).toBeGreaterThan(0);
    });
});

describe('bff proxy', () => {
    test('refuses an unauthenticated call', async () => {
        const res = await request(app).get('/bff/stats');
        expect(res.status).toBe(401);
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    test('forwards an authenticated call with the API key attached', async () => {
        const agent = await login(request.agent(app));
        const res = await agent.get('/bff/stats');

        expect(res.status).toBe(200);
        expect(lastRequest.url).toBe('http://atalaia-api.test/api/v1/stats');
        expect(lastRequest.options.headers['X-API-Key']).toBe('super-secret-api-key');
    });

    test('never leaks the API key to the browser', async () => {
        const agent = await login(request.agent(app));
        const res = await agent.get('/bff/stats');

        const exposed = JSON.stringify({ body: res.body, headers: res.headers });
        expect(exposed).not.toContain('super-secret-api-key');
    });

    test('preserves query strings when forwarding', async () => {
        const agent = await login(request.agent(app));
        await agent.get('/bff/vulnerabilities?severity=CRITICAL&limit=10');

        expect(lastRequest.url).toBe(
            'http://atalaia-api.test/api/v1/vulnerabilities?severity=CRITICAL&limit=10'
        );
    });

    test('forwards a JSON body on writes', async () => {
        const agent = await login(request.agent(app));
        await agent.patch('/bff/vulnerabilities/CVE-1/status').send({ status: 'RESOLVED' });

        expect(lastRequest.options.method).toBe('PATCH');
        expect(JSON.parse(lastRequest.options.body)).toEqual({ status: 'RESOLVED' });
    });

    test('maps an upstream 401 to 502 so the operator is not bounced to login', async () => {
        const agent = await login(request.agent(app));
        globalThis.fetch = jest.fn(async () => new Response('{"error":"Unauthorized"}', { status: 401 }));

        const res = await agent.get('/bff/stats');
        expect(res.status).toBe(502);
        expect(res.body.error).toMatch(/rejected the console API key/i);
    });

    test('reports an unreachable API as 502', async () => {
        const agent = await login(request.agent(app));
        globalThis.fetch = jest.fn(async () => {
            throw new Error('ECONNREFUSED');
        });

        const res = await agent.get('/bff/stats');
        expect(res.status).toBe(502);
        expect(res.body.error).toMatch(/unreachable/i);
    });

    test('passes an upstream error status through unchanged', async () => {
        const agent = await login(request.agent(app));
        globalThis.fetch = jest.fn(
            async () => new Response('{"error":"Not found"}', { status: 404 })
        );

        const res = await agent.get('/bff/vulnerabilities/CVE-0');
        expect(res.status).toBe(404);
    });

    test('logout invalidates the session', async () => {
        const agent = await login(request.agent(app));
        await agent.post('/auth/logout');

        const res = await agent.get('/bff/stats');
        expect(res.status).toBe(401);
    });
});
