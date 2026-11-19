/**
 * The enrichment pass asks for the ranges of stored CVEs that name something the
 * fleet runs, records what it gets, and stops when GitHub says enough.
 */
import { test, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { jest } from '@jest/globals';
import {
    describeWithDatabase as describe,
    hasDatabase,
    useSchema,
    setUpSchema,
    tearDownSchema,
    truncateAll,
} from '../../helpers/postgres.js';

const { schema } = useSchema('enrich_ranges');

const cache = await import('#app/infrastructure/cache/postgresCache.js');
const store = await import('#app/infrastructure/cache/repositoryStore.js');
const { enrichAdvisoryRanges } = await import('#app/application/enrichAdvisoryRanges.js');
const { queryAll } = await import('#app/infrastructure/db/pool.js');

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

    const repo = await store.addRepository({ name: 'r', url: 'https://github.com/acme/r', provider: 'github' });
    await store.replaceDependencies(repo.id, [
        { ecosystem: 'PIP', name: 'pillow', version: '==11.1.0', manifestFile: 'requirements.txt' },
        { ecosystem: 'NPM', name: 'lodash', version: '4.17.21', manifestFile: 'package-lock.json' },
    ]);
});

const store1 = (cveId, technologies) =>
    cache.add({ cveId, title: cveId, description: 'd', severity: 'HIGH', source: 'nvd', affectedTechnologies: technologies });

const pillow = [{ source: 'ghsa', ecosystem: 'PIP', name: 'pillow', vulnerableRange: '< 12.2.0', firstPatched: '12.2.0' }];

describe('enrichAdvisoryRanges', () => {
    test('stores what GitHub knows and records that it asked', async () => {
        await store1('CVE-1', ['pillow']);
        const lookup = jest.fn().mockResolvedValue(pillow);

        const result = await enrichAdvisoryRanges({ lookup });

        expect(lookup).toHaveBeenCalledWith('CVE-1');
        expect(result).toMatchObject({ checked: 1, withRanges: 1, failed: 0 });
        expect(await queryAll('SELECT package_name, vulnerable_range FROM advisory_packages')).toEqual([
            { package_name: 'pillow', vulnerable_range: '< 12.2.0' },
        ]);
    });

    test('does not ask about a CVE that names nothing the fleet runs', async () => {
        await store1('CVE-1', ['kubernetes']);
        const lookup = jest.fn().mockResolvedValue([]);

        await enrichAdvisoryRanges({ lookup });

        expect(lookup).not.toHaveBeenCalled();
    });

    test('a CVE GitHub does not know is checked once, not every run', async () => {
        await store1('CVE-1', ['pillow']);
        const lookup = jest.fn().mockResolvedValue([]);

        await enrichAdvisoryRanges({ lookup });
        await enrichAdvisoryRanges({ lookup });

        expect(lookup).toHaveBeenCalledTimes(1);
    });

    test('stops at the rate limit and leaves the rest to be asked again', async () => {
        await store1('CVE-1', ['pillow']);
        await store1('CVE-2', ['lodash']);
        const limited = Object.assign(new Error('rate limited'), { response: { status: 403 } });
        const lookup = jest.fn().mockRejectedValue(limited);

        const result = await enrichAdvisoryRanges({ lookup });

        expect(lookup).toHaveBeenCalledTimes(1);
        expect(result).toMatchObject({ stoppedEarly: true, failed: 1 });

        // Neither was recorded as checked, so the next run asks about both.
        const next = jest.fn().mockResolvedValue([]);
        await enrichAdvisoryRanges({ lookup: next });
        expect(next).toHaveBeenCalledTimes(2);
    });

    test('one failing lookup does not stop the others', async () => {
        await store1('CVE-1', ['pillow']);
        await store1('CVE-2', ['lodash']);
        const lookup = jest.fn().mockRejectedValueOnce(new Error('timeout')).mockResolvedValue([]);

        const result = await enrichAdvisoryRanges({ lookup });

        expect(result).toMatchObject({ checked: 1, failed: 1, stoppedEarly: false });
    });
});
