/**
 * Integration tests for the report routes.
 *
 * The generator itself is covered without a database in
 * tests/unit/application/dependencyReport.test.js. What is exercised here is the
 * half that needs one: the two inventory queries, which decide *which*
 * repositories a report speaks for — the fleet's enabled ones, or the single one
 * whose page asked.
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
import { listening, closeServer } from '../../helpers/server.js';

const { schema } = useSchema('report_routes');

process.env.API_KEY = 'test-api-key';

const { initializeDatabase } = await import('#app/infrastructure/cache/postgresCache.js');
const cache = await import('#app/infrastructure/cache/postgresCache.js');
const { createApp } = await import('#app/interface/http/createApp.js');
const { query, queryOne } = await import('#app/infrastructure/db/pool.js');

const KEY = { 'X-API-Key': 'test-api-key' };
let app;

async function addRepository({
    name,
    enabled = true,
    lastScannedAt = '2026-08-18T10:00:00Z',
    languages = { TypeScript: 8000 },
    topics = ['backend'],
}) {
    const row = await queryOne(
        `INSERT INTO repositories
             (name, url, provider, last_scanned_at, enabled, primary_language, languages, topics)
         VALUES (@name, @url, 'github', @lastScannedAt, @enabled, 'TypeScript', @languages, @topics)
         RETURNING id`,
        {
            name,
            url: `https://github.com/acme/${name}`,
            lastScannedAt,
            enabled,
            languages: JSON.stringify(languages),
            topics: JSON.stringify(topics),
        }
    );

    return row.id;
}

async function addDependency(repositoryId, dependency) {
    await query(
        `INSERT INTO repository_dependencies
             (repository_id, ecosystem, name, version, manifest_file,
              latest_version, latest_checked_at, latest_error)
         VALUES (@repositoryId, @ecosystem, @name, @version, @manifestFile,
                 @latestVersion, @checkedAt, @error)`,
        {
            repositoryId,
            ecosystem: dependency.ecosystem ?? 'NPM',
            name: dependency.name,
            version: dependency.version ?? null,
            manifestFile: dependency.manifestFile ?? 'package.json',
            latestVersion: dependency.latestVersion ?? null,
            checkedAt: dependency.checkedAt ?? null,
            error: dependency.error ?? null,
        }
    );
}

beforeAll(async () => {
    if (!hasDatabase) return;
    await setUpSchema(schema);
    await initializeDatabase();
    app = await listening(createApp(cache));
});

afterAll(async () => {
    if (!hasDatabase) return;
    await closeServer(app);
    await tearDownSchema(schema);
});

beforeEach(async () => {
    if (!hasDatabase) return;
    await truncateAll();
});

describe('GET /reports/dependencies', () => {
    test('the fleet report counts every state and never calls unchecked current', async () => {
        const api = await addRepository({ name: 'api' });
        const web = await addRepository({ name: 'web' });

        await addDependency(api, {
            name: 'lodash',
            version: '4.17.11',
            latestVersion: '4.17.21',
            checkedAt: '2026-08-19T09:00:00Z',
        });
        await addDependency(api, {
            name: 'express',
            version: '^4.18.0',
            latestVersion: '4.18.2',
            checkedAt: '2026-08-19T09:00:00Z',
        });
        await addDependency(web, { name: 'react', version: '^18.0.0' });

        const response = await request(app)
            .get('/api/v1/reports/dependencies')
            .set(KEY)
            .expect(200);

        const { report } = response.body;

        expect(report.scope).toEqual({ kind: 'fleet', repository: null });
        expect(report.dependencies.total).toBe(3);
        expect(report.dependencies.byState).toEqual({
            current: 1,
            behind: 1,
            unknown: 0,
            unchecked: 1,
        });
        expect(report.updates.packages.items[0]).toMatchObject({
            name: 'lodash',
            latest: '4.17.21',
            worstGap: 'patch',
            repositories: 1,
        });
        expect(report.technologies.languages[0]).toMatchObject({
            name: 'TypeScript',
            bytes: 16_000,
            repositories: 2,
        });
    });

    test('a disabled repository is out of the fleet report and in its own', async () => {
        const archived = await addRepository({ name: 'legacy', enabled: false });
        await addDependency(archived, { name: 'lodash', version: '3.10.1' });

        const fleet = await request(app)
            .get('/api/v1/reports/dependencies')
            .set(KEY)
            .expect(200);

        expect(fleet.body.report.coverage.repositories).toBe(0);
        expect(fleet.body.report.dependencies.total).toBe(0);

        const scoped = await request(app)
            .get(`/api/v1/reports/dependencies?repositoryId=${archived}`)
            .set(KEY)
            .expect(200);

        expect(scoped.body.report.scope).toEqual({
            kind: 'repository',
            repository: {
                id: archived,
                name: 'legacy',
                url: 'https://github.com/acme/legacy',
            },
        });
        expect(scoped.body.report.dependencies.total).toBe(1);
    });

    test('a scoped report covers that repository only', async () => {
        const api = await addRepository({ name: 'api' });
        const web = await addRepository({ name: 'web' });

        await addDependency(api, { name: 'lodash', version: '4.17.11' });
        await addDependency(web, { name: 'react', version: '17.0.2' });

        const response = await request(app)
            .get(`/api/v1/reports/dependencies?repositoryId=${web}`)
            .set(KEY)
            .expect(200);

        expect(response.body.report.coverage.repositories).toBe(1);
        expect(response.body.report.dependencies.total).toBe(1);
        expect(response.body.report.repositories.items[0].name).toBe('web');
    });

    test('a repository that has never been scanned is named in the notes', async () => {
        await addRepository({ name: 'untouched', lastScannedAt: null });

        const response = await request(app)
            .get('/api/v1/reports/dependencies')
            .set(KEY)
            .expect(200);

        const { report } = response.body;

        expect(report.coverage).toMatchObject({ repositories: 1, scanned: 0, neverScanned: 1 });
        expect(report.notes.some(note => note.text.includes('untouched'))).toBe(true);
    });

    test('a soft-deleted repository is gone from the report', async () => {
        const api = await addRepository({ name: 'api' });
        await addDependency(api, { name: 'lodash', version: '4.17.11' });
        await query('UPDATE repositories SET deleted_at = now() WHERE id = @id', { id: api });

        const response = await request(app)
            .get('/api/v1/reports/dependencies')
            .set(KEY)
            .expect(200);

        expect(response.body.report.coverage.repositories).toBe(0);
        expect(response.body.report.dependencies.total).toBe(0);
    });

    test('an unknown repository is a 404, not an empty report', async () => {
        const response = await request(app)
            .get('/api/v1/reports/dependencies?repositoryId=98765')
            .set(KEY)
            .expect(404);

        expect(response.body.error).toMatch(/not found/i);
    });

    test('a repositoryId that is not an integer is refused', async () => {
        await request(app)
            .get('/api/v1/reports/dependencies?repositoryId=api')
            .set(KEY)
            .expect(400);

        await request(app)
            .get('/api/v1/reports/dependencies?repositoryId=0')
            .set(KEY)
            .expect(400);
    });

    test('it needs the API key like every other route', async () => {
        await request(app).get('/api/v1/reports/dependencies').expect(401);
    });
});
