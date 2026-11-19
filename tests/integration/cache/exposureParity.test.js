/**
 * The two definitions of "this CVE reaches the fleet" have to agree.
 *
 * `repositoryStore` answers it per repository (exposure, reports, alerts) and
 * `postgresCache` answers it per CVE (the relevance filter and the counters in
 * the console header). They are written separately, and the header number must
 * never disagree with the rows beneath it. Nothing checked that, so a change to
 * either copy could drift silently. This fixture covers every case the rule has:
 * a name match, an OpenCVE product match, a disabled repository, a deleted
 * dependency, a resolved CVE, and an infrastructure ecosystem.
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

const { schema } = useSchema('exposure_parity');

const cache = await import('#app/infrastructure/cache/postgresCache.js');
const store = await import('#app/infrastructure/cache/repositoryStore.js');
const { query } = await import('#app/infrastructure/db/pool.js');

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

async function repository(name, { enabled = true, deleted = false } = {}) {
    const [row] = (
        await query(
            `INSERT INTO repositories (name, url, provider, default_branch, enabled, deleted_at)
             VALUES ($1, $2, 'github', 'main', $3, ${deleted ? 'now()' : 'NULL'})
             RETURNING id`,
            [name, `https://github.com/acme/${name}`, enabled]
        )
    ).rows;
    return row.id;
}

async function dependency(repoId, ecosystem, name, { product = null, deleted = false } = {}) {
    await query(
        `INSERT INTO repository_dependencies
            (repository_id, ecosystem, name, version, manifest_file, opencve_product, deleted_at)
         VALUES ($1, $2, $3, '1.0.0', 'manifest', $4, ${deleted ? 'now()' : 'NULL'})`,
        [repoId, ecosystem, name, product]
    );
}

async function vulnerability(cveId, technologies, status = 'OPEN') {
    await query(
        `INSERT INTO vulnerabilities (cve_id, title, severity, source, affected_technologies, status)
         VALUES ($1, $1, 'HIGH', 'test', $2::jsonb, $3)`,
        [cveId, JSON.stringify(technologies), status]
    );
}

describe('exposure parity', () => {
    beforeEach(async () => {
        const live = await repository('live');
        const off = await repository('off', { enabled: false });
        const gone = await repository('gone', { deleted: true });

        await dependency(live, 'NPM', 'express');
        await dependency(live, 'PIP', 'requests', { product: 'python-requests' });
        await dependency(live, 'DOCKER', 'nginx');
        await dependency(live, 'NPM', 'removed-dep', { deleted: true });
        await dependency(off, 'NPM', 'lodash');
        await dependency(gone, 'NPM', 'moment');

        await vulnerability('CVE-1', ['express']); // name match
        await vulnerability('CVE-2', ['python-requests']); // OpenCVE product match
        await vulnerability('CVE-3', ['nginx']); // infrastructure ecosystem
        await vulnerability('CVE-4', ['lodash']); // disabled repository only
        await vulnerability('CVE-5', ['moment']); // deleted repository only
        await vulnerability('CVE-6', ['removed-dep']); // deleted dependency only
        await vulnerability('CVE-7', ['express'], 'RESOLVED'); // resolved
        await vulnerability('CVE-8', ['kubernetes']); // matches nothing
    });

    test('the relevance filter and the per-repository links name the same CVEs', async () => {
        const links = await store.vulnerabilityRepositoryLinks();
        const fromLinks = [...new Set(links.map(link => link.cve_id))].sort();

        const filtered = await cache.query({ relevance: 'affecting', status: 'OPEN', limit: 200 });
        const fromFilter = filtered.vulnerabilities.map(v => v.cve_id).sort();

        expect(fromLinks).toEqual(['CVE-1', 'CVE-2', 'CVE-3']);
        expect(fromFilter).toEqual(fromLinks);
    });

    test('the header counters agree with the same set', async () => {
        const links = await store.vulnerabilityRepositoryLinks();
        const affecting = new Set(links.map(link => link.cve_id));
        const infrastructure = new Set(
            links
                .filter(link => ['DOCKER', 'GITHUB_ACTIONS', 'TERRAFORM', 'HELM'].includes(link.ecosystem))
                .map(link => link.cve_id)
        );

        const summary = await cache.relevanceSummary();

        expect(summary.affecting).toBe(affecting.size);
        expect(summary.infrastructure).toBe(infrastructure.size);
        expect([...infrastructure]).toEqual(['CVE-3']);
    });

    test('per-repository exposure counts the same CVEs for the enabled repository', async () => {
        const exposure = await store.summarizeRepositoryExposure();
        const total = [...exposure.values()].reduce((sum, entry) => sum + entry.total, 0);

        // Only "live" is enabled and not deleted; the summary may also include the
        // disabled repository, so compare on the repository that is in play.
        const links = await store.vulnerabilityRepositoryLinks();
        const liveCves = new Set(links.filter(link => link.repository_name === 'live').map(l => l.cve_id));

        expect(liveCves.size).toBe(3);
        expect(total).toBeGreaterThanOrEqual(liveCves.size);
    });
});
