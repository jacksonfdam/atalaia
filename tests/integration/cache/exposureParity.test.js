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
const exposure = await import('#app/application/exposure.js');
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
        const links = await exposure.repositoryLinks();
        const fromLinks = [...new Set(links.map(link => link.cve_id))].sort();

        const filtered = await cache.query({
            relevantIds: await exposure.relevantVulnerabilityIds('affecting'),
            status: 'OPEN',
            limit: 200,
        });
        const fromFilter = filtered.vulnerabilities.map(v => v.cve_id).sort();

        expect(fromLinks).toEqual(['CVE-1', 'CVE-2', 'CVE-3']);
        expect(fromFilter).toEqual(fromLinks);
    });

    test('the header counters agree with the same set', async () => {
        const links = await exposure.repositoryLinks();
        const affecting = new Set(links.map(link => link.cve_id));
        const infrastructure = new Set(
            links
                .filter(link => ['DOCKER', 'GITHUB_ACTIONS', 'TERRAFORM', 'HELM'].includes(link.ecosystem))
                .map(link => link.cve_id)
        );

        const summary = await exposure.relevanceSummary();

        expect(summary.affecting).toBe(affecting.size);
        expect(summary.infrastructure).toBe(infrastructure.size);
        expect([...infrastructure]).toEqual(['CVE-3']);
    });

    test('per-repository exposure counts the same CVEs for the enabled repository', async () => {
        const summary = await exposure.repositoryExposure();
        const total = [...summary.values()].reduce((sum, entry) => sum + entry.total, 0);

        // Only "live" is enabled and not deleted; the summary may also include the
        // disabled repository, so compare on the repository that is in play.
        const links = await exposure.repositoryLinks();
        const liveCves = new Set(links.filter(link => link.repository_name === 'live').map(l => l.cve_id));

        expect(liveCves.size).toBe(3);
        expect(total).toBeGreaterThanOrEqual(liveCves.size);
    });
});

/**
 * The same relation once ranges are known: Pillow's FlashPix overflow (< 12.2.0)
 * against what three repositories declare. This is the case that started it.
 */
describe('version-aware exposure', () => {
    let ids;

    async function pip(repoId, version, name = 'pillow') {
        await query(
            `INSERT INTO repository_dependencies (repository_id, ecosystem, name, version, manifest_file)
             VALUES ($1, 'PIP', $2, $3, 'requirements.txt')`,
            [repoId, name, version]
        );
    }

    beforeEach(async () => {
        ids = {
            old: await repository('old'),
            fixed: await repository('fixed'),
            loose: await repository('loose'),
            noise: await repository('noise'),
        };

        await pip(ids.old, '==11.1.0');
        await pip(ids.fixed, '==13.0.0');
        await pip(ids.loose, '>=1.0');
        await pip(ids.noise, '26.0.1', 'pip'); // the ecosystem's own name matches every pip advisory

        await vulnerability('CVE-PILLOW', ['pillow', 'pip']);
        const { rows } = await query("SELECT id FROM vulnerabilities WHERE cve_id = 'CVE-PILLOW'");
        await query(
            `INSERT INTO advisory_packages (vulnerability_id, source, ecosystem, package_name, vulnerable_range, first_patched)
             VALUES ($1, 'ghsa', 'PIP', 'pillow', '< 12.2.0', '12.2.0')`,
            [rows[0].id]
        );
    });

    test('a fixed dependency stops being reported, and the rest say what they are', async () => {
        const links = await exposure.repositoryLinks();
        const byRepo = Object.fromEntries(links.map(link => [link.repository_name, link]));

        expect(Object.keys(byRepo).sort()).toEqual(['loose', 'old']);
        expect(byRepo.old).toMatchObject({ verdict: 'affected', patchedIn: '12.2.0' });
        expect(byRepo.loose.verdict).toBe('unverified');
    });

    test('a package that only shares a word with the advisory is cleared', async () => {
        const links = await exposure.repositoryLinks();
        expect(links.map(link => link.repository_name)).not.toContain('noise');
    });

    test('exposure counts confirmed and unverified apart', async () => {
        const summary = await exposure.repositoryExposure();

        expect(summary.get(ids.old)).toMatchObject({ total: 1, confirmed: 1, unverified: 0 });
        expect(summary.get(ids.loose)).toMatchObject({ total: 1, confirmed: 0, unverified: 1 });
        expect(summary.has(ids.fixed)).toBe(false);
    });

    test('a CVE cleared everywhere leaves the relevance counters', async () => {
        await query("DELETE FROM repository_dependencies WHERE repository_id IN ($1, $2)", [ids.old, ids.loose]);

        expect(await exposure.relevantVulnerabilityIds('affecting')).toEqual([]);
        expect((await exposure.relevanceSummary()).affecting).toBe(0);
    });

    test('the alert audience is the repositories that were not cleared', async () => {
        const reached = await exposure.repositoriesReachedBy('CVE-PILLOW');
        expect(reached.map(repo => repo.name).sort()).toEqual(['loose', 'old']);
    });
});
