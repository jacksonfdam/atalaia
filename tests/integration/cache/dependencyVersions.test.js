/**
 * A file can hold one package at several versions. `version` keeps the lowest,
 * and `versions` has to survive a round trip through the database, because the
 * advisory check reads it.
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

const { schema } = useSchema('dependency_versions');

const cache = await import('#app/infrastructure/cache/postgresCache.js');
const store = await import('#app/infrastructure/cache/repositoryStore.js');

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

describe('dependency versions', () => {
    test('every copy is stored, and a single one stores none', async () => {
        const repo = await store.addRepository({ name: 'r', url: 'https://github.com/acme/r', provider: 'github' });

        await store.replaceDependencies(repo.id, [
            { ecosystem: 'NPM', name: 'lodash', version: '4.17.21', versions: ['4.17.21', '5.0.0'], manifestFile: 'package-lock.json' },
            { ecosystem: 'NPM', name: 'express', version: '4.0.0', manifestFile: 'package-lock.json' },
        ]);

        const rows = await store.getDependenciesByRepo(repo.id);
        const byName = Object.fromEntries(rows.map(row => [row.name, row]));

        expect(byName.lodash.versions).toEqual(['4.17.21', '5.0.0']);
        expect(byName.express.versions).toBeNull();
    });

    test('a rescan that finds one copy clears the others', async () => {
        const repo = await store.addRepository({ name: 'r', url: 'https://github.com/acme/r', provider: 'github' });
        const lodash = { ecosystem: 'NPM', name: 'lodash', version: '4.17.21', manifestFile: 'package-lock.json' };

        await store.replaceDependencies(repo.id, [{ ...lodash, versions: ['4.17.21', '5.0.0'] }]);
        await store.replaceDependencies(repo.id, [lodash]);

        const [row] = await store.getDependenciesByRepo(repo.id);
        expect(row.versions).toBeNull();
    });
});
