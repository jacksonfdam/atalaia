/**
 * Advisory ranges are stored per source and replaced wholesale, and a CVE that
 * is not stored never gets any.
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

const { schema } = useSchema('advisory_store');

const cache = await import('#app/infrastructure/cache/postgresCache.js');
const advisories = await import('#app/infrastructure/cache/advisoryStore.js');
const { queryAll, queryOne } = await import('#app/infrastructure/db/pool.js');

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

const pillow = { ecosystem: 'PIP', name: 'Pillow', vulnerableRange: '< 12.2.0', firstPatched: '12.2.0' };

async function store(cveId, technologies = ['pillow']) {
    await cache.add({
        cveId,
        title: cveId,
        description: 'd',
        severity: 'CRITICAL',
        source: 'nvd',
        affectedTechnologies: technologies,
    });
}

describe('advisoryStore', () => {
    test('stores ranges for a stored CVE, lowercasing the package name', async () => {
        await store('CVE-1');

        expect(await advisories.replaceAdvisoryPackages('CVE-1', 'ghsa', [pillow])).toBe(1);

        const rows = await queryAll('SELECT package_name, vulnerable_range, first_patched FROM advisory_packages');
        expect(rows).toEqual([{ package_name: 'pillow', vulnerable_range: '< 12.2.0', first_patched: '12.2.0' }]);
    });

    test('ignores a CVE that is not stored', async () => {
        expect(await advisories.replaceAdvisoryPackages('CVE-NOPE', 'ghsa', [pillow])).toBe(0);
        expect(await queryAll('SELECT 1 FROM advisory_packages')).toEqual([]);
    });

    test('replaces what one source said, and leaves another source alone', async () => {
        await store('CVE-1');

        await advisories.replaceAdvisoryPackages('CVE-1', 'ghsa', [pillow]);
        await advisories.replaceAdvisoryPackages('CVE-1', 'mitre', [{ ...pillow, vulnerableRange: '< 11.0' }]);
        await advisories.replaceAdvisoryPackages('CVE-1', 'ghsa', [{ ...pillow, vulnerableRange: '< 13.0.0' }]);

        const rows = await queryAll('SELECT source, vulnerable_range FROM advisory_packages ORDER BY source');
        expect(rows).toEqual([
            { source: 'ghsa', vulnerable_range: '< 13.0.0' },
            { source: 'mitre', vulnerable_range: '< 11.0' },
        ]);
    });

    test('records that ranges were asked for, even when the source had none', async () => {
        await store('CVE-1');

        await advisories.replaceAdvisoryPackages('CVE-1', 'ghsa', []);

        const row = await queryOne('SELECT ranges_checked_at FROM vulnerabilities WHERE cve_id = $1', ['CVE-1']);
        expect(row.ranges_checked_at).not.toBeNull();
    });

    test('asks only for CVEs that name a dependency and have not been checked', async () => {
        await store('CVE-1'); // names a dependency, never checked
        await store('CVE-2', ['kubernetes']); // names nothing the fleet ships
        await store('CVE-3'); // names a dependency, checked just now

        const [{ id }] = await queryAll(
            `INSERT INTO repositories (name, url, provider, default_branch) VALUES ('r', 'https://github.com/a/r', 'github', 'main') RETURNING id`
        );
        await queryAll(
            `INSERT INTO repository_dependencies (repository_id, ecosystem, name, version, manifest_file)
             VALUES ($1, 'PIP', 'pillow', '1.0', 'requirements.txt')`,
            [id]
        );
        await advisories.replaceAdvisoryPackages('CVE-3', 'ghsa', []);

        expect(await advisories.cvesNeedingRanges()).toEqual(['CVE-1']);
    });
});
