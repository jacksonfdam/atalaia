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
const { resetFleetScanState } = await import('#app/application/repositoryScanRunner.js');
const { compareVersions } = await import('#app/application/versionComparison.js');

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

describe('repository exposure', () => {
    let repoId;

    beforeEach(async () => {
        getDb().exec("DELETE FROM vulnerabilities;");

        const created = await request(app)
            .post('/api/v1/repositories')
            .set(KEY)
            .send({ url: 'https://github.com/acme/pipeline' });
        repoId = created.body.id;

        getDb()
            .prepare(
                `INSERT INTO repository_dependencies (repository_id, ecosystem, name, version, manifest_file)
                 VALUES (?, 'GITHUB_ACTIONS', 'actions/checkout', 'v3', '.github/workflows/ci.yml'),
                        (?, 'NPM', 'express', '4.0.0', 'package.json')`
            )
            .run(repoId, repoId);

        getDb()
            .prepare(
                `INSERT INTO vulnerabilities (cve_id, title, severity, cvss_score, exploited, source, affected_technologies, status)
                 VALUES ('CVE-2026-1000', 'Bad action', 'CRITICAL', 9.8, 1, 'ghsa', '["actions/checkout"]', 'OPEN'),
                        ('CVE-2026-1001', 'Old express', 'MEDIUM', 5.3, 0, 'ghsa', '["express"]', 'OPEN'),
                        ('CVE-2026-1002', 'Fixed already', 'HIGH', 7.5, 0, 'nvd', '["express"]', 'RESOLVED'),
                        ('CVE-2026-1003', 'Unrelated', 'HIGH', 7.1, 0, 'nvd', '["kubernetes"]', 'OPEN')`
            )
            .run();
    });

    test('lists what reaches the repository, and through which dependency', async () => {
        const res = await request(app).get(`/api/v1/repositories/${repoId}/vulnerabilities`).set(KEY);

        expect(res.status).toBe(200);
        expect(res.body.count).toBe(2);
        expect(res.body.worst).toBe('CRITICAL');
        expect(res.body.exploited).toBe(1);

        const action = res.body.vulnerabilities.find(v => v.cveId === 'CVE-2026-1000');
        expect(action.matches).toEqual([
            expect.objectContaining({
                dependency: 'actions/checkout',
                ecosystem: 'GITHUB_ACTIONS',
                manifestFile: '.github/workflows/ci.yml',
            }),
        ]);
    });

    test('leaves out what does not reach it, and what is already resolved', async () => {
        const res = await request(app).get(`/api/v1/repositories/${repoId}/vulnerabilities`).set(KEY);
        const ids = res.body.vulnerabilities.map(v => v.cveId);

        expect(ids).not.toContain('CVE-2026-1003');
        expect(ids).not.toContain('CVE-2026-1002');
    });

    test('includes resolved ones on request', async () => {
        const res = await request(app)
            .get(`/api/v1/repositories/${repoId}/vulnerabilities?includeResolved=true`)
            .set(KEY);

        expect(res.body.vulnerabilities.map(v => v.cveId)).toContain('CVE-2026-1002');
    });

    test('the list endpoint carries the exposure of every repository', async () => {
        const res = await request(app).get('/api/v1/repositories').set(KEY);

        expect(res.body.atRisk).toBe(1);
        expect(res.body.repositories[0].risk).toMatchObject({
            total: 2,
            worst: 'CRITICAL',
            exploited: true,
            bySeverity: { CRITICAL: 1, MEDIUM: 1 },
        });
    });
});

describe('fleet scan', () => {
    beforeEach(() => {
        resetFleetScanState();
    });

    test('reports an idle scanner', async () => {
        const res = await request(app).get('/api/v1/repositories/scan-all').set(KEY);

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ running: false, progress: null, lastRun: null });
    });

    test('accepts the trigger without waiting for the scan', async () => {
        const res = await request(app).post('/api/v1/repositories/scan-all').set(KEY).send({});

        // 202, not 200: the work outlives the request by design.
        expect(res.status).toBe(202);
        expect(res.body.accepted).toBe(true);
    });

    test('records the run once it finishes', async () => {
        await request(app).post('/api/v1/repositories/scan-all').set(KEY).send({});

        // No organizations registered, so the scan resolves on the next tick.
        await new Promise(resolve => setTimeout(resolve, 50));

        const res = await request(app).get('/api/v1/repositories/scan-all').set(KEY);
        expect(res.body.running).toBe(false);
        expect(res.body.lastRun).toMatchObject({ ok: true, repositories: 0 });
    });
});

describe('repository list: filters, sorting and pagination', () => {
    beforeEach(async () => {
        getDb().exec('DELETE FROM repositories; DELETE FROM repository_dependencies; DELETE FROM vulnerabilities;');

        const insert = getDb().prepare(
            `INSERT INTO repositories (name, url, provider, org_key, primary_language, description, enabled, archived)
             VALUES (@name, @url, 'github', @org, @language, @description, @enabled, @archived)`
        );

        insert.run({ name: 'acme/api', url: 'https://github.com/acme/api', org: 'acme', language: 'TypeScript', description: 'public api', enabled: 1, archived: 0 });
        insert.run({ name: 'acme/web', url: 'https://github.com/acme/web', org: 'acme', language: 'TypeScript', description: 'storefront', enabled: 1, archived: 0 });
        insert.run({ name: 'acme/legacy', url: 'https://github.com/acme/legacy', org: 'acme', language: 'Perl', description: 'old thing', enabled: 0, archived: 1 });
        insert.run({ name: 'other/tool', url: 'https://github.com/other/tool', org: 'other', language: 'Go', description: 'cli', enabled: 1, archived: 0 });

        // Only acme/api is exposed, and by a known-exploited CVE.
        const apiId = getDb().prepare("SELECT id FROM repositories WHERE name = 'acme/api'").get().id;
        getDb()
            .prepare(
                `INSERT INTO repository_dependencies (repository_id, ecosystem, name, manifest_file)
                 VALUES (?, 'NPM', 'express', 'package.json')`
            )
            .run(apiId);
        getDb()
            .prepare(
                `INSERT INTO vulnerabilities (cve_id, title, severity, exploited, source, affected_technologies, status)
                 VALUES ('CVE-2026-2000', 'Express', 'HIGH', 1, 'ghsa', '["express"]', 'OPEN')`
            )
            .run();
    });

    const get = query => request(app).get(`/api/v1/repositories${query}`).set(KEY);

    test('paginates and reports the total behind the page', async () => {
        const res = await get('?limit=2&offset=0&sort=name&order=asc');

        expect(res.body).toMatchObject({ count: 2, total: 4, limit: 2, offset: 0 });
        expect(res.body.repositories.map(r => r.name)).toEqual(['acme/api', 'acme/legacy']);

        const second = await get('?limit=2&offset=2&sort=name&order=asc');
        expect(second.body.repositories.map(r => r.name)).toEqual(['acme/web', 'other/tool']);
    });

    test('caps an absurd page size', async () => {
        expect((await get('?limit=99999')).body.limit).toBe(200);
    });

    test('filters by organization, language and status', async () => {
        expect((await get('?org=acme')).body.total).toBe(3);
        expect((await get('?language=typescript')).body.total).toBe(2);
        expect((await get('?enabled=false')).body.total).toBe(1);
        expect((await get('?archived=true')).body.repositories[0].name).toBe('acme/legacy');
    });

    test('searches name and description', async () => {
        expect((await get('?search=storefront')).body.repositories.map(r => r.name)).toEqual(['acme/web']);
        expect((await get('?search=acme/')).body.total).toBe(3);
    });

    test('filters by exposure', async () => {
        expect((await get('?exposure=affected')).body.repositories.map(r => r.name)).toEqual(['acme/api']);
        expect((await get('?exposure=exploited')).body.total).toBe(1);
        expect((await get('?exposure=clean')).body.total).toBe(3);
    });

    test('sorts by exposure, worst first', async () => {
        const res = await get('?sort=exposure&order=desc');
        expect(res.body.repositories[0].name).toBe('acme/api');
    });

    test('offers the values its filter menus need', async () => {
        const { facets } = (await get('')).body;

        expect(facets.organizations).toEqual([
            { value: 'acme', count: 3 },
            { value: 'other', count: 1 },
        ]);
        expect(facets.languages[0]).toEqual({ value: 'TypeScript', count: 2 });
    });

    test('ignores a sort column that is not on the whitelist', async () => {
        const res = await get('?sort=name); DROP TABLE repositories;--');

        expect(res.status).toBe(200);
        expect(res.body.total).toBe(4);
    });
});

describe('dependency freshness', () => {
    let repoId;

    beforeEach(async () => {
        getDb().exec('DELETE FROM repositories; DELETE FROM repository_dependencies;');

        const created = await request(app)
            .post('/api/v1/repositories')
            .set(KEY)
            .send({ url: 'https://github.com/acme/api' });
        repoId = created.body.id;

        getDb()
            .prepare(
                `INSERT INTO repository_dependencies
                    (repository_id, ecosystem, name, version, manifest_file, latest_version, latest_checked_at)
                 VALUES (?, 'NPM', 'express', '^4.17.1', 'package.json', '5.2.1', datetime('now')),
                        (?, 'NPM', 'lodash', '4.17.21', 'package.json', '4.17.21', datetime('now')),
                        (?, 'DOCKER', 'node', '18-alpine', 'Dockerfile', NULL, NULL)`
            )
            .run(repoId, repoId, repoId);
    });

    test('reports which dependencies are behind their registry', async () => {
        const res = await request(app).get(`/api/v1/repositories/${repoId}/dependencies`).set(KEY);

        expect(res.body).toMatchObject({ count: 3, outdated: 1, unchecked: 1 });

        const express = res.body.dependencies.find(d => d.name === 'express');
        const lodash = res.body.dependencies.find(d => d.name === 'lodash');

        expect(express).toMatchObject({ latest_version: '5.2.1', outdated: true });
        // Same version, declared with a range prefix: not behind.
        expect(lodash.outdated).toBe(false);
    });

    test('exposes the state of the version check', async () => {
        const res = await request(app).get(`/api/v1/repositories/${repoId}/versions`).set(KEY);
        expect(res.body).toMatchObject({ running: false, lastRun: null });
    });

    test('404s for a repository that does not exist', async () => {
        expect((await request(app).get('/api/v1/repositories/9999/versions').set(KEY)).status).toBe(404);
        expect((await request(app).post('/api/v1/repositories/9999/versions').set(KEY).send({})).status).toBe(404);
    });
});

describe('version comparison', () => {
    test.each([
        ['NPM', '^4.17.1', '5.2.1', 'behind', 'major'],
        ['NPM', '^5.0.0', '5.2.1', 'current', null],
        ['NPM', '~5.2.0', '5.2.1', 'current', null],
        ['CARGO', '1.0.200', '1.0.229', 'behind', 'patch'],
        ['GO', 'v1.7.6', 'v1.12.0', 'behind', 'minor'],
        ['GITHUB_ACTIONS', 'v4', 'v7.0.1', 'behind', 'major'],
        ['GITHUB_ACTIONS', 'v7', 'v7.0.1', 'current', null],
        ['RUBYGEMS', '~> 6.1', '8.1.3', 'behind', 'major'],
        ['RUBYGEMS', '~> 8.1', '8.1.3', 'current', null],
        ['PIP', '==2.28.0', '2.34.2', 'behind', 'minor'],
        ['PIP', '~=2.34.0', '2.34.2', 'current', null],
    ])('%s %s vs %s', (ecosystem, declared, latest, state, gap) => {
        expect(compareVersions(ecosystem, declared, latest)).toMatchObject({ state, gap });
    });

    test.each([
        // A commit pin, a Maven interval and a tag that is not a version: all
        // real, none of them comparable — answered as such rather than guessed.
        ['GITHUB_ACTIONS', 'f1a2b3c4d5e6', 'v7.0.1'],
        ['MAVEN', '[1.0,2.0)', '1.9.0'],
        ['NPM', null, '5.0.0'],
        ['NPM', '1.0.0', null],
    ])('%s %s vs %s is unknown', (ecosystem, declared, latest) => {
        const result = compareVersions(ecosystem, declared, latest);
        expect(result.state).toBe('unknown');
        expect(result.reason).toBeTruthy();
    });

    test('a declared version ahead of the registry is not chased', () => {
        expect(compareVersions('NPM', '6.0.0-beta.1', '5.2.1').state).toBe('current');
    });
});

describe('vulnerability relevance', () => {
    beforeEach(async () => {
        getDb().exec('DELETE FROM repositories; DELETE FROM repository_dependencies; DELETE FROM vulnerabilities;');

        const created = await request(app)
            .post('/api/v1/repositories')
            .set(KEY)
            .send({ url: 'https://github.com/acme/api' });

        getDb()
            .prepare(
                `INSERT INTO repository_dependencies (repository_id, ecosystem, name, manifest_file)
                 VALUES (?, 'NPM', 'express', 'package.json'),
                        (?, 'GITHUB_ACTIONS', 'actions/checkout', '.github/workflows/ci.yml'),
                        (?, 'DOCKER', 'node', 'Dockerfile')`
            )
            .run(created.body.id, created.body.id, created.body.id);

        getDb()
            .prepare(
                `INSERT INTO vulnerabilities (cve_id, title, severity, exploited, source, affected_technologies, status)
                 VALUES ('CVE-2026-3000', 'Express', 'HIGH', 0, 'ghsa', '["express"]', 'OPEN'),
                        ('CVE-2026-3001', 'Checkout', 'HIGH', 0, 'ghsa', '["actions/checkout"]', 'OPEN'),
                        ('CVE-2026-3002', 'Node image', 'MEDIUM', 0, 'nvd', '["node"]', 'OPEN'),
                        ('CVE-2026-3003', 'Something in Wordpress', 'CRITICAL', 0, 'nvd', '["wordpress"]', 'OPEN'),
                        ('CVE-2026-3004', 'Kubernetes', 'HIGH', 0, 'nvd', '["kubernetes"]', 'OPEN')`
            )
            .run();
    });

    const ids = body => body.vulnerabilities.map(v => v.cve_id).sort();

    test('keeps only what names something the fleet uses', async () => {
        const res = await request(app).get('/api/v1/vulnerabilities?relevance=affecting').set(KEY);

        expect(ids(res.body)).toEqual(['CVE-2026-3000', 'CVE-2026-3001', 'CVE-2026-3002']);
        expect(res.body.total).toBe(3);
    });

    test('narrows to containers and CI on request', async () => {
        const res = await request(app).get('/api/v1/vulnerabilities?relevance=infrastructure').set(KEY);

        // The Docker image and the workflow action; not the npm package.
        expect(ids(res.body)).toEqual(['CVE-2026-3001', 'CVE-2026-3002']);
    });

    test('still returns everything when asked', async () => {
        expect((await request(app).get('/api/v1/vulnerabilities').set(KEY)).body.total).toBe(5);
    });

    test('reports the counts behind the filter', async () => {
        const res = await request(app).get('/api/v1/vulnerabilities').set(KEY);

        expect(res.body.relevance).toEqual({ total: 5, affecting: 3, infrastructure: 2 });
    });

    test('a disabled repository stops counting', async () => {
        getDb().prepare('UPDATE repositories SET enabled = 0').run();

        const res = await request(app).get('/api/v1/vulnerabilities?relevance=affecting').set(KEY);
        expect(res.body.total).toBe(0);
    });
});

describe('LLM settings', () => {
    const LLM_ENV = ['LLM_PROVIDER', 'OPENAI_API_KEY', 'OPENAI_MODEL', 'OLLAMA_URL', 'OLLAMA_MODEL'];

    beforeEach(() => {
        getDb().exec('DELETE FROM llm_config;');
        for (const key of LLM_ENV) delete process.env[key];
    });

    test('offers local and hosted providers, and says which is which', async () => {
        const res = await request(app).get('/api/v1/settings/llm').set(KEY);

        expect(res.body.providers.map(p => p.id)).toEqual([
            'ollama',
            'lmstudio',
            'openai',
            'anthropic',
            'gemini',
            'openrouter',
            'groq',
            'custom',
        ]);
        expect(res.body.providers.find(p => p.id === 'ollama')).toMatchObject({
            kind: 'local',
            requiresKey: false,
        });
        expect(res.body.providers.find(p => p.id === 'anthropic')).toMatchObject({
            kind: 'hosted',
            requiresKey: true,
        });
    });

    test('stores a hosted provider and fills in its defaults', async () => {
        const res = await request(app)
            .put('/api/v1/settings/llm')
            .set(KEY)
            .send({ provider: 'openai', apiKey: 'sk-test-ABCD1234', enabled: true });

        expect(res.body.config).toMatchObject({
            provider: 'openai',
            model: 'gpt-4o-mini',
            baseUrl: 'https://api.openai.com/v1',
            hasApiKey: true,
            apiKeyHint: '••••1234',
        });
        expect(res.body.status).toMatchObject({ ready: true, kind: 'hosted', source: 'database' });
    });

    test('never returns the key, and never stores it in the clear', async () => {
        await request(app)
            .put('/api/v1/settings/llm')
            .set(KEY)
            .send({ provider: 'openai', apiKey: 'sk-test-ABCD1234', enabled: true });

        const res = await request(app).get('/api/v1/settings/llm').set(KEY);
        expect(JSON.stringify(res.body)).not.toContain('sk-test-ABCD1234');

        const row = getDb().prepare('SELECT api_key_cipher FROM llm_config').get();
        expect(row.api_key_cipher).not.toContain('sk-test');
    });

    test('drops the key when the provider changes', async () => {
        await request(app)
            .put('/api/v1/settings/llm')
            .set(KEY)
            .send({ provider: 'openai', apiKey: 'sk-test-ABCD1234', enabled: true });

        const res = await request(app).put('/api/v1/settings/llm').set(KEY).send({ provider: 'groq' });
        expect(res.body.config.hasApiKey).toBe(false);
    });

    test('a local provider is ready with no key at all', async () => {
        const res = await request(app)
            .put('/api/v1/settings/llm')
            .set(KEY)
            .send({ provider: 'ollama', enabled: true });

        expect(res.body.status).toMatchObject({ ready: true, kind: 'local' });
    });

    test('is not ready while explanations are switched off', async () => {
        const res = await request(app)
            .put('/api/v1/settings/llm')
            .set(KEY)
            .send({ provider: 'ollama', enabled: false });

        expect(res.body.status.ready).toBe(false);
        expect(res.body.status.reason).toContain('switched off');
    });

    test('rejects an unknown provider and a payload with none', async () => {
        expect((await request(app).put('/api/v1/settings/llm').set(KEY).send({ provider: 'pigeon' })).status).toBe(400);
        expect((await request(app).put('/api/v1/settings/llm').set(KEY).send({})).status).toBe(400);
    });

    test('refuses to write while LLM_PROVIDER is set', async () => {
        process.env.LLM_PROVIDER = 'openai';

        const res = await request(app)
            .put('/api/v1/settings/llm')
            .set(KEY)
            .send({ provider: 'ollama', enabled: true });

        expect(res.status).toBe(409);
        expect(res.body.error).toMatch(/LLM_PROVIDER/);
    });
});
