/**
 * Integration tests for organizations, repository management and feed control.
 *
 * The app is mounted with supertest against a temporary SQLite file. Nothing
 * here touches GitHub: the import path is covered by asserting that the
 * provider is only ever asked to read, which is done in a unit test.
 */
import { describe, test, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import request from 'supertest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const TMP_DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'atalaia-orgs-')), 'test.db');

process.env.DB_PATH = TMP_DB;
process.env.API_KEY = 'test-api-key';
process.env.TOKEN_ENCRYPTION_KEY = 'test-encryption-key';

const cache = await import('#app/infrastructure/cache/sqliteCache.js');
const { initializeDatabase, getDb } = cache;
const { createApp } = await import('#app/interface/http/createApp.js');

const KEY = { 'X-API-Key': 'test-api-key' };
let app;

beforeAll(() => {
    initializeDatabase();
    app = createApp(cache);
});

afterAll(() => {
    fs.rmSync(path.dirname(TMP_DB), { recursive: true, force: true });
});

beforeEach(() => {
    getDb().exec('DELETE FROM repository_dependencies; DELETE FROM repositories; DELETE FROM organizations; DELETE FROM feed_state;');
});

describe('POST /api/v1/organizations', () => {
    test('stores an organization and reports that a token is held', async () => {
        const res = await request(app)
            .post('/api/v1/organizations')
            .set(KEY)
            .send({ login: 'acme', token: 'ghp_supersecret9999' });

        expect(res.status).toBe(201);
        expect(res.body).toMatchObject({ key: 'acme', login: 'acme', hasToken: true, enabled: true });
        expect(res.body.tokenHint).toBe('••••9999');
    });

    test('never returns the token, and never stores it in the clear', async () => {
        await request(app)
            .post('/api/v1/organizations')
            .set(KEY)
            .send({ login: 'acme', token: 'ghp_supersecret9999' });

        const listed = await request(app).get('/api/v1/organizations').set(KEY);
        expect(JSON.stringify(listed.body)).not.toContain('ghp_supersecret9999');

        const stored = getDb().prepare('SELECT token_cipher FROM organizations').get();
        expect(stored.token_cipher).not.toContain('ghp_supersecret');
    });

    test('rejects a request without a login', async () => {
        const res = await request(app).post('/api/v1/organizations').set(KEY).send({});
        expect(res.status).toBe(400);
    });

    test('keeps the stored token when the organization is added again without one', async () => {
        await request(app).post('/api/v1/organizations').set(KEY).send({ login: 'acme', token: 'ghp_first1111' });
        const res = await request(app).post('/api/v1/organizations').set(KEY).send({ login: 'acme', name: 'Acme Inc' });

        expect(res.body.hasToken).toBe(true);
        expect(res.body.tokenHint).toBe('••••1111');
        expect(res.body.name).toBe('Acme Inc');
    });
});

describe('PATCH /api/v1/organizations/:key', () => {
    beforeEach(async () => {
        await request(app).post('/api/v1/organizations').set(KEY).send({ login: 'acme', token: 'ghp_first1111' });
    });

    test('disables an organization', async () => {
        const res = await request(app).patch('/api/v1/organizations/acme').set(KEY).send({ enabled: false });
        expect(res.body.enabled).toBe(false);
    });

    test('replaces the token', async () => {
        const res = await request(app).patch('/api/v1/organizations/acme').set(KEY).send({ token: 'ghp_second2222' });
        expect(res.body.tokenHint).toBe('••••2222');
    });

    test('clears the token when given an empty string', async () => {
        const res = await request(app).patch('/api/v1/organizations/acme').set(KEY).send({ token: '' });
        expect(res.body.hasToken).toBe(false);
    });

    test('404s for an unknown organization', async () => {
        const res = await request(app).patch('/api/v1/organizations/nope').set(KEY).send({ enabled: false });
        expect(res.status).toBe(404);
    });
});

describe('DELETE /api/v1/organizations/:key', () => {
    test('removes the organization together with its repositories', async () => {
        await request(app).post('/api/v1/organizations').set(KEY).send({ login: 'acme' });
        await request(app)
            .post('/api/v1/repositories')
            .set(KEY)
            .send({ url: 'https://github.com/acme/api', orgKey: 'acme' });

        const res = await request(app).delete('/api/v1/organizations/acme').set(KEY);

        expect(res.body).toMatchObject({ deleted: true, repositories: 1 });
        const repos = await request(app).get('/api/v1/repositories').set(KEY);
        expect(repos.body.count).toBe(0);
    });
});

describe('selective import', () => {
    test('rejects a selection that is not an array of strings', async () => {
        await request(app).post('/api/v1/organizations').set(KEY).send({ login: 'acme' });

        const res = await request(app)
            .post('/api/v1/organizations/acme/import')
            .set(KEY)
            .send({ repositories: [{ name: 'acme/api' }] });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/array of names or URLs/);
    });

    test('404s when listing repositories of an unknown organization', async () => {
        const res = await request(app).get('/api/v1/organizations/ghost/repositories').set(KEY);
        expect(res.status).toBe(404);
    });
});

describe('repository management', () => {
    let repoId;

    beforeEach(async () => {
        const created = await request(app)
            .post('/api/v1/repositories')
            .set(KEY)
            .send({ url: 'https://github.com/acme/api' });
        repoId = created.body.id;
    });

    test('disables a repository without deleting it', async () => {
        const res = await request(app).patch(`/api/v1/repositories/${repoId}`).set(KEY).send({ enabled: false });

        expect(res.status).toBe(200);
        expect(res.body.enabled).toBe(0);

        const list = await request(app).get('/api/v1/repositories').set(KEY);
        expect(list.body.count).toBe(1);
    });

    test('rejects a patch without a boolean', async () => {
        const res = await request(app).patch(`/api/v1/repositories/${repoId}`).set(KEY).send({ enabled: 'yes' });
        expect(res.status).toBe(400);
    });

    test('restores a soft-deleted repository', async () => {
        await request(app).delete(`/api/v1/repositories/${repoId}`).set(KEY);
        expect((await request(app).get('/api/v1/repositories').set(KEY)).body.count).toBe(0);

        const res = await request(app).post(`/api/v1/repositories/${repoId}/restore`).set(KEY);

        expect(res.status).toBe(200);
        expect((await request(app).get('/api/v1/repositories').set(KEY)).body.count).toBe(1);
    });

    test('reports technologies from both the provider and the manifests', async () => {
        getDb()
            .prepare('UPDATE repositories SET primary_language = ?, languages = ?, topics = ? WHERE id = ?')
            .run('TypeScript', JSON.stringify({ TypeScript: 750, CSS: 250 }), JSON.stringify(['api']), repoId);

        getDb()
            .prepare(
                `INSERT INTO repository_dependencies (repository_id, ecosystem, name, version, manifest_file)
                 VALUES (?, 'NPM', 'express', '5.0.0', 'package.json')`
            )
            .run(repoId);

        const res = await request(app).get(`/api/v1/repositories/${repoId}/technologies`).set(KEY);

        expect(res.body.primaryLanguage).toBe('TypeScript');
        expect(res.body.languages).toEqual([
            { name: 'TypeScript', bytes: 750, share: 75 },
            { name: 'CSS', bytes: 250, share: 25 },
        ]);
        expect(res.body.topics).toEqual(['api']);
        expect(res.body.ecosystems).toEqual([{ name: 'NPM', packages: 1 }]);
        expect(res.body.dependencyCount).toBe(1);
    });
});

describe('feed control', () => {
    test('lists every source with its catalog entry', async () => {
        const res = await request(app).get('/api/v1/feeds').set(KEY);

        const nvd = res.body.feeds.find(feed => feed.name === 'nvd');
        expect(nvd).toMatchObject({ enabled: true, defaultEnabled: true, overridden: false });
        expect(nvd.catalog.maintainer).toBe('NIST');
    });

    test('enables a source that is off by default, and the change survives a re-read', async () => {
        const patched = await request(app).patch('/api/v1/feeds/ubuntu').set(KEY).send({ enabled: true });
        expect(patched.body).toMatchObject({ name: 'ubuntu', enabled: true, overridden: true });

        const listed = await request(app).get('/api/v1/feeds').set(KEY);
        expect(listed.body.feeds.find(feed => feed.name === 'ubuntu').enabled).toBe(true);
    });

    test('dropping the override restores the registry default', async () => {
        await request(app).patch('/api/v1/feeds/nvd').set(KEY).send({ enabled: false });
        const res = await request(app).delete('/api/v1/feeds/nvd/override').set(KEY);

        expect(res.body).toMatchObject({ enabled: true, overridden: false });
    });

    test('rejects a non-boolean and an unknown source', async () => {
        expect((await request(app).patch('/api/v1/feeds/nvd').set(KEY).send({ enabled: 1 })).status).toBe(400);
        expect((await request(app).patch('/api/v1/feeds/nope').set(KEY).send({ enabled: true })).status).toBe(404);
    });

    test('exposes the database catalog, including the entries with no adapter', async () => {
        const res = await request(app).get('/api/v1/feeds/catalog').set(KEY);

        expect(res.body.count).toBeGreaterThan(30);
        expect(res.body.implemented).toBeLessThan(res.body.count);

        const osv = res.body.databases.find(entry => entry.abbreviation === 'OSV');
        expect(osv.feed).toBeNull();
        expect(osv.noAdapterReason).toBeTruthy();
    });
});
