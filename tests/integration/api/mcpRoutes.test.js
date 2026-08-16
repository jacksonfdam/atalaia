/**
 * Integration tests for the MCP endpoint.
 *
 * The transport is exercised for real over supertest — a JSON-RPC initialize,
 * a tools/list and tools/call against the same throwaway schema the REST tests
 * use — so a tool that is registered but broken fails here rather than in an
 * agent's session.
 */
import { test, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import request from 'supertest';
import {
    describeWithDatabase as describe,
    hasDatabase,
    useSchema,
    setUpSchema,
    tearDownSchema,
    truncateAll,
} from '../../helpers/postgres.js';

const { schema } = useSchema('mcp_routes');

process.env.API_KEY = 'test-api-key';

const { initializeDatabase } = await import('#app/infrastructure/cache/postgresCache.js');
const cache = await import('#app/infrastructure/cache/postgresCache.js');
const { createApp } = await import('#app/interface/http/createApp.js');
const { createTools } = await import('#app/interface/mcp/tools.js');
const { query, queryOne } = await import('#app/infrastructure/db/pool.js');

const KEY = { 'X-API-Key': 'test-api-key' };
const ACCEPT = 'application/json, text/event-stream';

let app;
let nextId = 1;

/** One JSON-RPC call. Stateless, so every request stands on its own. */
function rpc(method, params = {}, headers = KEY) {
    return request(app)
        .post('/mcp')
        .set(headers)
        .set('Accept', ACCEPT)
        .set('Content-Type', 'application/json')
        .send({ jsonrpc: '2.0', id: nextId++, method, params });
}

async function callTool(name, args = {}) {
    const res = await rpc('tools/call', { name, arguments: args });
    expect(res.status).toBe(200);
    return res.body.result;
}

/** Tool payloads are JSON in a text block. */
function payload(result) {
    return JSON.parse(result.content[0].text);
}

async function seedVuln(row) {
    await query(
        `INSERT INTO vulnerabilities
             (cve_id, title, description, severity, cvss_score, exploited, source, affected_technologies, status)
         VALUES (@cveId, @title, @description, @severity, @cvss, @exploited, @source, @tech, @status)`,
        {
            cveId: row.cveId,
            title: row.title ?? row.cveId,
            description: row.description ?? '',
            severity: row.severity ?? 'UNKNOWN',
            cvss: row.cvss ?? null,
            exploited: Boolean(row.exploited),
            source: row.source ?? 'nvd',
            tech: JSON.stringify(row.technologies ?? []),
            status: row.status ?? 'OPEN',
        }
    );
}

async function seedRepo(name, url) {
    const row = await queryOne(
        `INSERT INTO repositories (name, url, provider, enabled)
         VALUES (@name, @url, 'github', true) RETURNING id`,
        { name, url }
    );
    return Number(row.id);
}

beforeAll(async () => {
    if (!hasDatabase) return;
    await setUpSchema(schema);
    await initializeDatabase();
    app = createApp(cache);
});

afterAll(async () => {
    if (!hasDatabase) return;
    await tearDownSchema(schema);
});

beforeEach(async () => {
    // Re-asserted per test rather than only at import: jest runs several suites
    // in one worker process, and they share process.env. Setting it once at the
    // top leaves the value at the mercy of whichever file was evaluated last.
    process.env.API_KEY = 'test-api-key';
    delete process.env.MCP_API_KEY;

    if (!hasDatabase) return;
    await truncateAll();
});

describe('MCP authentication', () => {
    test('rejects a request with no API key', async () => {
        const res = await request(app)
            .post('/mcp')
            .set('Accept', ACCEPT)
            .send({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });

        expect(res.status).toBe(401);
    });

    test('accepts the API key as a bearer token', async () => {
        const res = await rpc('tools/list', {}, { Authorization: 'Bearer test-api-key' });
        expect(res.status).toBe(200);
    });

    test('rejects a wrong bearer token', async () => {
        const res = await rpc('tools/list', {}, { Authorization: 'Bearer nope' });
        expect(res.status).toBe(401);
    });
});

describe('an agent given a key of its own', () => {
    // The REST key can rewrite where alerts go and which model reads the CVE
    // text. Nothing an agent does over MCP needs that, so the two keys are
    // separated — and separating them only means anything if each one is
    // refused where it does not belong.
    beforeEach(() => {
        process.env.MCP_API_KEY = 'agent-only-key';
    });

    afterEach(() => {
        delete process.env.MCP_API_KEY;
    });

    test('reaches MCP with it', async () => {
        const res = await rpc('tools/list', {}, { 'X-API-Key': 'agent-only-key' });
        expect(res.status).toBe(200);
    });

    test('cannot reach the REST API with it', async () => {
        await request(app).get('/api/v1/stats').set('X-API-Key', 'agent-only-key').expect(401);
        await request(app).get('/api/v1/organizations').set('X-API-Key', 'agent-only-key').expect(401);
    });

    test('and the REST key stops opening MCP', async () => {
        const res = await rpc('tools/list', {}, { 'X-API-Key': 'test-api-key' });
        expect(res.status).toBe(401);
    });
});

describe('MCP protocol', () => {
    test('initialize answers with the server identity', async () => {
        const res = await rpc('initialize', {
            protocolVersion: '2025-06-18',
            capabilities: {},
            clientInfo: { name: 'test-agent', version: '1.0.0' },
        });

        expect(res.status).toBe(200);
        expect(res.body.result.serverInfo.name).toBe('atalaia');
        expect(res.body.result.instructions).toContain('Atalaia');
    });

    test('every registered tool is listed, with a schema', async () => {
        const res = await rpc('tools/list');

        expect(res.status).toBe(200);
        const listed = res.body.result.tools.map(tool => tool.name).sort();
        const registered = createTools(cache).map(tool => tool.name).sort();

        expect(listed).toEqual(registered);
        for (const tool of res.body.result.tools) {
            expect(tool.description).toBeTruthy();
            expect(tool.inputSchema.type).toBe('object');
        }
    });

    test('only explain_vulnerability is declared as a write', async () => {
        const res = await rpc('tools/list');

        const writes = res.body.result.tools
            .filter(tool => tool.annotations?.readOnlyHint !== true)
            .map(tool => tool.name);

        expect(writes).toEqual(['explain_vulnerability']);
    });

    test('GET is refused: the endpoint is stateless', async () => {
        const res = await request(app).get('/mcp').set(KEY);
        expect(res.status).toBe(405);
    });
});

describe('vulnerability tools', () => {
    test('list_vulnerabilities returns summaries and totals', async () => {
        await seedVuln({ cveId: 'CVE-2024-0001', severity: 'CRITICAL', technologies: ['express'] });
        await seedVuln({ cveId: 'CVE-2024-0002', severity: 'LOW' });

        const data = payload(await callTool('list_vulnerabilities', {}));

        expect(data.total).toBe(2);
        expect(data.vulnerabilities).toHaveLength(2);
        expect(data.vulnerabilities[0]).toHaveProperty('cveId');
        expect(data.vulnerabilities[0]).not.toHaveProperty('description');
    });

    test('list_vulnerabilities filters by severity', async () => {
        await seedVuln({ cveId: 'CVE-2024-0001', severity: 'CRITICAL' });
        await seedVuln({ cveId: 'CVE-2024-0002', severity: 'LOW' });

        const data = payload(await callTool('list_vulnerabilities', { severity: 'CRITICAL' }));

        expect(data.total).toBe(1);
        expect(data.vulnerabilities[0].cveId).toBe('CVE-2024-0001');
    });

    test('an invalid filter value is refused by the schema', async () => {
        const result = await callTool('list_vulnerabilities', { severity: 'CATASTROPHIC' });
        expect(result.isError).toBe(true);
    });

    test('get_vulnerability carries the description, timeline and correlation', async () => {
        await seedVuln({
            cveId: 'CVE-2024-0003',
            title: 'Something in express',
            description: 'A long description',
            severity: 'HIGH',
        });

        const data = payload(await callTool('get_vulnerability', { cveId: 'CVE-2024-0003' }));

        expect(data.vulnerability.description).toBe('A long description');
        expect(data.vulnerability.explained).toBe(false);
        expect(data.timeline.some(event => event.event === 'DISCOVERED')).toBe(true);
        expect(data.affectedRepositories).toEqual([]);
    });

    test('an unknown CVE is a tool error, not a protocol error', async () => {
        const result = await callTool('get_vulnerability', { cveId: 'CVE-1999-9999' });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('not found');
    });

    test('query_by_technology finds what names the technology', async () => {
        await seedVuln({
            cveId: 'CVE-2024-0004',
            title: 'express prototype pollution',
            technologies: ['express'],
        });
        await seedVuln({ cveId: 'CVE-2024-0006', technologies: ['express'], status: 'RESOLVED' });

        const data = payload(await callTool('query_by_technology', { technologies: ['express'] }));

        // Resolved findings are left out: the question is what is still open.
        expect(data.count).toBe(1);
        expect(data.vulnerabilities[0].cveId).toBe('CVE-2024-0004');
    });

    test('get_stats counts by severity and status', async () => {
        await seedVuln({ cveId: 'CVE-2024-0005', severity: 'CRITICAL' });

        const data = payload(await callTool('get_stats'));

        expect(data.relevance).toHaveProperty('affecting');
        expect(JSON.stringify(data)).toContain('CRITICAL');
    });
});

describe('repository tools', () => {
    test('list_repositories reports exposure per repository', async () => {
        await seedRepo('acme/api', 'https://github.com/acme/api');

        const data = payload(await callTool('list_repositories', {}));

        expect(data.total).toBe(1);
        expect(data.repositories[0].name).toBe('acme/api');
        expect(data.repositories[0].risk.total).toBe(0);
        expect(data.repositories[0].lastScannedAt).toBeNull();
    });

    test('a repository can be addressed by id or by URL', async () => {
        const id = await seedRepo('acme/web', 'https://github.com/acme/web');

        const byId = payload(await callTool('get_repository', { repository: String(id) }));
        const byUrl = payload(await callTool('get_repository', {
            repository: 'https://github.com/acme/web',
        }));

        expect(byId.repository.id).toBe(id);
        expect(byUrl.repository.id).toBe(id);
    });

    test('an unknown repository is a tool error', async () => {
        const result = await callTool('list_repository_dependencies', { repository: '99999' });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('not found');
    });

    test('list_repository_dependencies groups by ecosystem and flags what is behind', async () => {
        const id = await seedRepo('acme/app', 'https://github.com/acme/app');
        await query(
            `INSERT INTO repository_dependencies
                 (repository_id, ecosystem, name, version, manifest_file, latest_version, latest_checked_at)
             VALUES (@id, 'NPM', 'express', '4.18.0', 'package.json', '4.19.2', now()),
                    (@id, 'NPM', 'pino', '10.0.0', 'package.json', NULL, NULL)`,
            { id }
        );

        const data = payload(await callTool('list_repository_dependencies', { repository: String(id) }));

        expect(data.count).toBe(2);
        expect(data.outdated).toBe(1);
        expect(data.unchecked).toBe(1);
        expect(data.groups[0]).toMatchObject({ ecosystem: 'NPM', count: 2 });

        const outdated = payload(
            await callTool('list_repository_dependencies', { repository: String(id), outdatedOnly: true })
        );

        // The totals stay fleet-wide; only the rows are narrowed.
        expect(outdated.count).toBe(2);
        expect(outdated.dependencies).toHaveLength(1);
        expect(outdated.dependencies[0].name).toBe('express');
    });

    test('list_repository_vulnerabilities is empty for an unscanned repository', async () => {
        const id = await seedRepo('acme/empty', 'https://github.com/acme/empty');

        const data = payload(await callTool('list_repository_vulnerabilities', { repository: String(id) }));

        expect(data.count).toBe(0);
        expect(data.worst).toBeNull();
    });
});

describe('context tools', () => {
    test('list_owners names the people alerts route to, and no way to reach them', async () => {
        await query(
            `INSERT INTO system_owners (name, email, slack_user_id, telegram_chat_id)
             VALUES ('Security', 'sec@example.com', 'U123', '-1001234')`
        );

        const result = await callTool('list_owners');
        const data = payload(result);

        expect(data.count).toBe(1);
        expect(data.owners[0].name).toBe('Security');
        // Which channels work, not where they point: an address and a chat id
        // are somebody's personal data, and an agent puts whatever it is given
        // into a context window.
        expect(data.owners[0].channels).toEqual(['email', 'slack', 'telegram']);

        const serialized = JSON.stringify(result);
        expect(serialized).not.toContain('sec@example.com');
        expect(serialized).not.toContain('U123');
        expect(serialized).not.toContain('-1001234');
    });

    test('get_weekly_report says why it is empty rather than returning nothing', async () => {
        const data = payload(await callTool('get_weekly_report'));

        expect(data.report).toBeNull();
        expect(data.reason).toBeTruthy();
    });
});
