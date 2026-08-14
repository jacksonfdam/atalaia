/**
 * Integration tests for the REST API.
 *
 * The app is mounted with supertest against a throwaway Postgres schema, so
 * routes, middleware and the real persistence layer are all exercised — no port
 * is opened, no scheduler starts, and no feed is contacted.
 */
import { test, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import request from 'supertest';
import {
    describeWithDatabase as describe,
    hasDatabase,
    useSchema,
    setUpSchema,
    tearDownSchema,
    truncateAll,
} from '../../helpers/postgres.js';

const { schema } = useSchema('api_routes');

process.env.API_KEY = 'test-api-key';

const { initializeDatabase } = await import('#app/infrastructure/cache/postgresCache.js');
const cache = await import('#app/infrastructure/cache/postgresCache.js');
const { createApp } = await import('#app/interface/http/createApp.js');
const { query } = await import('#app/infrastructure/db/pool.js');

// Cleared *after* the imports: config.js calls dotenv.config(), which would
// repopulate these from the developer's .env and make writable settings look
// env-pinned. Env-pinning has its own dedicated test below.
delete process.env.SLACK_ENABLED;
delete process.env.LLM_PROVIDER;
delete process.env.CRON_SCHEDULE;

const KEY = { 'X-API-Key': 'test-api-key' };
let app;

async function seed(rows) {
    for (const row of rows) {
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
    if (!hasDatabase) return;
    await truncateAll();
});

describe('authentication', () => {
    test('rejects a request with no API key', async () => {
        const res = await request(app).get('/api/v1/stats');
        expect(res.status).toBe(401);
        expect(res.body.error).toBe('Unauthorized');
    });

    test('rejects a request with the wrong API key', async () => {
        const res = await request(app).get('/api/v1/stats').set('X-API-Key', 'nope');
        expect(res.status).toBe(401);
    });

    test('accepts a request with the correct API key', async () => {
        const res = await request(app).get('/api/v1/stats').set(KEY);
        expect(res.status).toBe(200);
    });

    test('/health needs no key', async () => {
        const res = await request(app).get('/health');
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('ok');
    });
});

describe('GET /vulnerabilities', () => {
    beforeEach(async () => {
        await seed([
            { cveId: 'CVE-2026-0001', severity: 'CRITICAL', cvss: 9.8, source: 'nvd', technologies: ['npm'] },
            { cveId: 'CVE-2026-0002', severity: 'HIGH', cvss: 7.5, source: 'cisa', technologies: ['pip'] },
            { cveId: 'CVE-2026-0003', severity: 'LOW', cvss: 2.1, source: 'nvd', status: 'RESOLVED' },
            { cveId: 'CVE-2026-0004', severity: 'CRITICAL', cvss: 9.1, source: 'nvd', exploited: true },
        ]);
    });

    test('returns every row with a total', async () => {
        const res = await request(app).get('/api/v1/vulnerabilities').set(KEY);
        expect(res.status).toBe(200);
        expect(res.body.total).toBe(4);
        expect(res.body.vulnerabilities).toHaveLength(4);
    });

    test('paginates and reports the unpaginated total', async () => {
        const res = await request(app).get('/api/v1/vulnerabilities?limit=2&offset=1').set(KEY);
        expect(res.body.total).toBe(4);
        expect(res.body.count).toBe(2);
        expect(res.body.limit).toBe(2);
        expect(res.body.offset).toBe(1);
    });

    test('clamps an oversized limit instead of returning everything', async () => {
        const res = await request(app).get('/api/v1/vulnerabilities?limit=100000').set(KEY);
        expect(res.body.limit).toBe(200);
    });

    test('falls back to the default limit for a non-numeric value', async () => {
        const res = await request(app).get('/api/v1/vulnerabilities?limit=drop%20table').set(KEY);
        expect(res.body.limit).toBe(50);
    });

    test('rejects a negative offset', async () => {
        const res = await request(app).get('/api/v1/vulnerabilities?offset=-10').set(KEY);
        expect(res.body.offset).toBe(0);
    });

    test('filters by severity, status, source and exploited', async () => {
        const bySeverity = await request(app).get('/api/v1/vulnerabilities?severity=CRITICAL').set(KEY);
        expect(bySeverity.body.total).toBe(2);

        const byStatus = await request(app).get('/api/v1/vulnerabilities?status=RESOLVED').set(KEY);
        expect(byStatus.body.total).toBe(1);

        const bySource = await request(app).get('/api/v1/vulnerabilities?source=cisa').set(KEY);
        expect(bySource.body.total).toBe(1);

        const exploited = await request(app).get('/api/v1/vulnerabilities?exploited=true').set(KEY);
        expect(exploited.body.total).toBe(1);
        expect(exploited.body.vulnerabilities[0].cve_id).toBe('CVE-2026-0004');
    });

    test('matches a technology exactly, not as a prefix', async () => {
        await seed([{ cveId: 'CVE-2026-0009', technologies: ['npm-audit'] }]);
        const res = await request(app).get('/api/v1/vulnerabilities?tech=npm').set(KEY);
        expect(res.body.vulnerabilities.map(v => v.cve_id)).toEqual(['CVE-2026-0001']);
    });

    test('ignores an unknown sort column rather than interpolating it', async () => {
        const res = await request(app)
            .get('/api/v1/vulnerabilities?sort=cve_id;DROP%20TABLE%20vulnerabilities')
            .set(KEY);
        expect(res.status).toBe(200);
        expect(res.body.total).toBe(4);
    });

    test('sorts by a whitelisted column', async () => {
        const res = await request(app).get('/api/v1/vulnerabilities?sort=cvss_score&order=asc').set(KEY);
        expect(res.body.vulnerabilities[0].cve_id).toBe('CVE-2026-0003');
    });
});

describe('GET /vulnerabilities/:cveId', () => {
    test('returns the vulnerability with a timeline', async () => {
        await seed([{ cveId: 'CVE-2026-0100', severity: 'HIGH', source: 'nvd' }]);
        const res = await request(app).get('/api/v1/vulnerabilities/CVE-2026-0100').set(KEY);

        expect(res.status).toBe(200);
        expect(res.body.vulnerability.cve_id).toBe('CVE-2026-0100');
        expect(Array.isArray(res.body.timeline)).toBe(true);
        expect(res.body.timeline.some(e => e.event === 'DISCOVERED')).toBe(true);
    });

    test('404s for an unknown CVE', async () => {
        const res = await request(app).get('/api/v1/vulnerabilities/CVE-0000-0000').set(KEY);
        expect(res.status).toBe(404);
    });
});

describe('PATCH /vulnerabilities/:cveId/status', () => {
    beforeEach(() => seed([{ cveId: 'CVE-2026-0200', severity: 'HIGH' }]));

    test('rejects a request with no body', async () => {
        const res = await request(app).patch('/api/v1/vulnerabilities/CVE-2026-0200/status').set(KEY);
        expect(res.status).toBe(400);
    });

    test('rejects an unsupported status', async () => {
        const res = await request(app)
            .patch('/api/v1/vulnerabilities/CVE-2026-0200/status')
            .set(KEY)
            .send({ status: 'WONTFIX', changedBy: 'test' });
        expect(res.status).toBe(400);
    });

    test('acknowledges and persists the new status', async () => {
        const res = await request(app)
            .patch('/api/v1/vulnerabilities/CVE-2026-0200/status')
            .set(KEY)
            .send({ status: 'ACKNOWLEDGED', changedBy: 'test' });

        expect(res.status).toBe(200);
        expect((await cache.get('CVE-2026-0200')).status).toBe('ACKNOWLEDGED');
    });

    test('404s for an unknown CVE', async () => {
        const res = await request(app)
            .patch('/api/v1/vulnerabilities/CVE-0000-0000/status')
            .set(KEY)
            .send({ status: 'ACKNOWLEDGED', changedBy: 'test' });
        expect(res.status).toBe(404);
    });
});

describe('GET /stats', () => {
    test('aggregates by status, severity and source', async () => {
        await seed([
            { cveId: 'CVE-2026-0301', severity: 'CRITICAL', source: 'nvd', exploited: true },
            { cveId: 'CVE-2026-0302', severity: 'CRITICAL', source: 'cisa' },
            { cveId: 'CVE-2026-0303', severity: 'LOW', source: 'nvd', status: 'RESOLVED' },
        ]);

        const res = await request(app).get('/api/v1/stats').set(KEY);
        expect(res.body.total).toBe(3);
        expect(res.body.exploited).toBe(1);
        expect(res.body.bySeverity.CRITICAL).toBe(2);
        expect(res.body.byStatus.RESOLVED).toBe(1);
        expect(res.body.bySource.nvd).toBe(2);
    });
});

describe('settings', () => {
    test('describes writable settings and credential presence without leaking values', async () => {
        process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.test/secret-value';

        const res = await request(app).get('/api/v1/settings').set(KEY);
        expect(res.status).toBe(200);

        const webhook = res.body.credentials.find(c => c.key === 'slack.webhookUrl');
        expect(webhook.configured).toBe(true);
        expect(JSON.stringify(res.body)).not.toContain('secret-value');

        delete process.env.SLACK_WEBHOOK_URL;
    });

    test('refuses to write a secret', async () => {
        const res = await request(app)
            .put('/api/v1/settings')
            .set(KEY)
            .send({ settings: { 'slack.webhookUrl': 'https://evil.example' } });

        expect(res.status).toBe(400);
        expect(res.body.rejected).toEqual(['slack.webhookUrl']);
    });

    test('rejects the whole payload when any key is unwritable', async () => {
        const res = await request(app)
            .put('/api/v1/settings')
            .set(KEY)
            .send({ settings: { 'repositories.scanCron': '0 4 * * *', 'api.key': 'stolen' } });

        expect(res.status).toBe(400);
        // The valid key must not have been applied either.
        const after = await request(app).get('/api/v1/settings').set(KEY);
        expect(after.body.settings.find(s => s.key === 'repositories.scanCron').value).toBe('0 3 * * *');
    });

    test('persists a writable setting and reports its source', async () => {
        const res = await request(app)
            .put('/api/v1/settings')
            .set(KEY)
            .send({ settings: { 'repositories.autoScan': true }, changedBy: 'console:test' });

        expect(res.status).toBe(200);
        const slack = res.body.settings.find(s => s.key === 'repositories.autoScan');
        expect(slack.value).toBe(true);
        expect(slack.source).toBe('database');
        expect(slack.updatedBy).toBe('console:test');
    });

    test('refuses to write a setting pinned by an environment variable', async () => {
        process.env.REPO_SCAN_CRON = '0 5 * * *';

        const res = await request(app)
            .put('/api/v1/settings')
            .set(KEY)
            .send({ settings: { 'repositories.scanCron': '0 4 * * *' } });

        expect(res.status).toBe(409);
        expect(res.body.locked).toEqual(['repositories.scanCron']);

        delete process.env.REPO_SCAN_CRON;
    });

    test('rejects a non-object payload', async () => {
        const res = await request(app).put('/api/v1/settings').set(KEY).send({ settings: ['nope'] });
        expect(res.status).toBe(400);
    });
});

describe('feeds', () => {
    test('lists the registry without touching the network', async () => {
        const res = await request(app).get('/api/v1/feeds').set(KEY);
        expect(res.status).toBe(200);

        const names = res.body.feeds.map(f => f.name);
        expect(names).toContain('nvd');
        expect(names).toContain('snyk');

        const disabled = res.body.feeds.find(f => f.name === 'cvedetails');
        expect(disabled.enabled).toBe(false);
        expect(disabled.disabledReason).toBeTruthy();
    });
});

describe('repositories and owners', () => {
    beforeEach(async () => {
        // TRUNCATE ... CASCADE handles the foreign keys, so the order no longer
        // has to be spelled out here.
        await truncateAll();
    });

    test('rejects a repository with no url', async () => {
        const res = await request(app).post('/api/v1/repositories').set(KEY).send({});
        expect(res.status).toBe(400);
    });

    test('creates, lists and soft-deletes a repository', async () => {
        const created = await request(app)
            .post('/api/v1/repositories')
            .set(KEY)
            .send({ url: 'https://github.com/acme/widget.git' });

        expect(created.status).toBe(201);
        // The .git suffix is normalised away so the same repo cannot be added twice.
        expect(created.body.url).toBe('https://github.com/acme/widget');

        const listed = await request(app).get('/api/v1/repositories').set(KEY);
        expect(listed.body.count).toBe(1);

        const deleted = await request(app).delete(`/api/v1/repositories/${created.body.id}`).set(KEY);
        expect(deleted.status).toBe(200);

        const afterDelete = await request(app).get('/api/v1/repositories').set(KEY);
        expect(afterDelete.body.count).toBe(0);
    });

    test('404s for an unknown repository', async () => {
        const res = await request(app).get('/api/v1/repositories/9999').set(KEY);
        expect(res.status).toBe(404);
    });

    test('creates an owner and assigns a target', async () => {
        const owner = await request(app)
            .post('/api/v1/owners')
            .set(KEY)
            .send({ name: 'Platform', email: 'platform@acme.test' });
        expect(owner.status).toBe(201);

        const assignment = await request(app)
            .post(`/api/v1/owners/${owner.body.id}/assignments`)
            .set(KEY)
            .send({ targetType: 'ecosystem', targetValue: 'npm' });
        expect(assignment.status).toBe(201);

        const detail = await request(app).get(`/api/v1/owners/${owner.body.id}`).set(KEY);
        expect(detail.body.assignments).toHaveLength(1);
    });

    test('rejects an owner with no email', async () => {
        const res = await request(app).post('/api/v1/owners').set(KEY).send({ name: 'Nobody' });
        expect(res.status).toBe(400);
    });

    test('rejects an invalid assignment target type', async () => {
        const owner = await request(app)
            .post('/api/v1/owners')
            .set(KEY)
            .send({ name: 'Platform', email: 'p@acme.test' });

        const res = await request(app)
            .post(`/api/v1/owners/${owner.body.id}/assignments`)
            .set(KEY)
            .send({ targetType: 'galaxy', targetValue: 'npm' });

        expect(res.status).toBe(400);
    });
});

describe('scan', () => {
    test('reports an idle cycle', async () => {
        const res = await request(app).get('/api/v1/scan').set(KEY);
        expect(res.status).toBe(200);
        expect(res.body.running).toBe(false);
    });
});
