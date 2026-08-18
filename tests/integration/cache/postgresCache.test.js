/**
 * The persistence layer, against a real Postgres.
 *
 * The suite this replaced reimplemented the cache inside the test file and then
 * asserted against its own copy, so a bug in the real module could never fail
 * it. Here the module under test is the one the service runs.
 */
import { test, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import {
    describeWithDatabase as describe,
    hasDatabase,
    useSchema,
    setUpSchema,
    tearDownSchema,
    truncateAll,
} from '../../helpers/postgres.js';

const { schema } = useSchema('postgres_cache');

const cache = await import('#app/infrastructure/cache/postgresCache.js');
const { toDate } = await import('#app/infrastructure/db/pool.js');

beforeAll(async () => {
    if (!hasDatabase) return;
    await setUpSchema(schema);
    await cache.initializeDatabase();
});

afterAll(async () => {
    if (!hasDatabase) return;
    await tearDownSchema(schema);
});

beforeEach(async () => {
    if (!hasDatabase) return;
    await truncateAll();
});

const sampleVuln = {
    cveId: 'CVE-2024-0001',
    title: 'Test Vuln',
    description: 'A test',
    severity: 'HIGH',
    cvssScore: 7.5,
    exploited: false,
    source: 'test',
    link: 'https://example.com',
    affectedTechnologies: ['react', 'node.js'],
};

describe('postgresCache', () => {
    test('has() is false for a CVE that was never stored', async () => {
        expect(await cache.has('CVE-NOPE')).toBe(false);
    });

    test('add() inserts, and has() finds it', async () => {
        await cache.add(sampleVuln);
        expect(await cache.has('CVE-2024-0001')).toBe(true);
    });

    test('get() returns the row, with its technologies as an array', async () => {
        await cache.add(sampleVuln);

        const row = await cache.get('CVE-2024-0001');
        expect(row).not.toBeNull();
        expect(row.cve_id).toBe('CVE-2024-0001');
        expect(row.severity).toBe('HIGH');
        expect(row.affectedTechnologies).toEqual(['react', 'node.js']);
        // jsonb, so it is a real array rather than a string that looks like one.
        expect(Array.isArray(row.affected_technologies)).toBe(true);
    });

    test('get() returns null for a CVE that does not exist', async () => {
        expect(await cache.get('CVE-NOPE')).toBeNull();
    });

    test('update() changes only the fields it is given', async () => {
        await cache.add(sampleVuln);
        await cache.update('CVE-2024-0001', { status: 'ACKNOWLEDGED', statusChangedBy: 'tester' });

        const row = await cache.get('CVE-2024-0001');
        expect(row.status).toBe('ACKNOWLEDGED');
        expect(row.status_changed_by).toBe('tester');
        expect(row.title).toBe('Test Vuln');
    });

    test('getAll() returns everything stored', async () => {
        await cache.add(sampleVuln);
        await cache.add({ ...sampleVuln, cveId: 'CVE-2024-0002', severity: 'CRITICAL' });

        expect(await cache.getAll()).toHaveLength(2);
    });

    test('the same CVE twice is one row, and the later source wins', async () => {
        await cache.add(sampleVuln);
        await cache.add({ ...sampleVuln, source: 'ghsa', link: 'https://ghsa.example' });

        expect(await cache.getAll()).toHaveLength(1);

        const row = await cache.get('CVE-2024-0001');
        expect(row.source).toBe('ghsa');
        expect(row.source_url).toBe('https://ghsa.example');
    });

    test('status defaults to OPEN', async () => {
        await cache.add(sampleVuln);
        expect((await cache.get('CVE-2024-0001')).status).toBe('OPEN');
    });

    test('exploited round-trips as a boolean', async () => {
        await cache.add({ ...sampleVuln, cveId: 'CVE-2024-0003', exploited: true });
        expect((await cache.get('CVE-2024-0003')).exploited).toBe(true);
    });

    test('query() filters by technology on whole names, not substrings', async () => {
        await cache.add(sampleVuln);

        expect((await cache.query({ tech: 'react' })).total).toBe(1);
        // 'act' is inside 'react'; a substring match would find it.
        expect((await cache.query({ tech: 'act' })).total).toBe(0);
    });

    test('query() ignores a sort column that is not on the whitelist', async () => {
        await cache.add(sampleVuln);

        const result = await cache.query({ sort: 'title; DROP TABLE vulnerabilities' });
        expect(result.total).toBe(1);
        expect(await cache.has('CVE-2024-0001')).toBe(true);
    });

    // timestamptz comes back as the text Postgres wrote, by design — see pool.js.
    const publishedIso = async cveId => {
        const parsed = toDate((await cache.get(cveId)).published_date);
        return parsed === null ? null : parsed.toISOString();
    };

    test('add() stores the publication date, and null when there is none', async () => {
        const published = new Date('2026-08-10T12:00:00Z');
        await cache.add({ ...sampleVuln, publishedDate: published });
        await cache.add({ ...sampleVuln, cveId: 'CVE-2024-0002', publishedDate: null });

        expect(await publishedIso('CVE-2024-0001')).toBe(published.toISOString());
        expect(await publishedIso('CVE-2024-0002')).toBeNull();
    });

    test('a second sighting does not erase a date already recorded', async () => {
        const published = new Date('2026-08-10T12:00:00Z');
        await cache.add({ ...sampleVuln, publishedDate: published });
        // The same CVE from a feed that publishes no date.
        await cache.add({ ...sampleVuln, source: 'vuldb', publishedDate: null });

        expect(await publishedIso('CVE-2024-0001')).toBe(published.toISOString());
    });

    test('a later sighting fills in a date the first one lacked', async () => {
        await cache.add({ ...sampleVuln, publishedDate: null });
        await cache.add({ ...sampleVuln, publishedDate: new Date('2026-08-10T12:00:00Z') });

        expect((await cache.get('CVE-2024-0001')).published_date).not.toBeNull();
    });

    test('a stored vulnerability is not marked as announced until it is', async () => {
        await cache.add(sampleVuln);
        expect((await cache.get('CVE-2024-0001')).notified_at).toBeNull();

        await cache.markNotified('CVE-2024-0001');
        expect((await cache.get('CVE-2024-0001')).notified_at).not.toBeNull();
    });

    test('query() sorts by publication date', async () => {
        await cache.add({ ...sampleVuln, publishedDate: new Date('2026-08-01T00:00:00Z') });
        await cache.add({ ...sampleVuln, cveId: 'CVE-2024-0002', publishedDate: new Date('2026-08-15T00:00:00Z') });

        const result = await cache.query({ sort: 'published_date', order: 'desc' });
        expect(result.vulnerabilities[0].cve_id).toBe('CVE-2024-0002');
    });

    test('stats() counts in SQL and returns numbers, not strings', async () => {
        await cache.add(sampleVuln);
        await cache.add({ ...sampleVuln, cveId: 'CVE-2024-0002', severity: 'CRITICAL', exploited: true });

        const stats = await cache.stats();
        expect(stats.total).toBe(2);
        expect(typeof stats.total).toBe('number');
        expect(stats.exploited).toBe(1);
        expect(stats.bySeverity).toEqual({ HIGH: 1, CRITICAL: 1 });
    });
});
