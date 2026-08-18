import { jest } from '@jest/globals';
import { batchVulnStatus } from '../../../src/application/batchVulnStatus.js';

/**
 * A batch acts on a selection made from a table, so some of it will always be
 * unactionable by the time the button is pressed. What matters is that the rest
 * still happens and that the caller is told which was which.
 */
describe('batchVulnStatus', () => {
    /** A cache over a fixed set of rows, keyed by CVE. */
    function cacheOf(rows) {
        const store = new Map(rows.map(row => [row.cve_id, { ...row }]));

        return {
            store,
            get: jest.fn(async cveId => store.get(cveId) ?? null),
            update: jest.fn(async (cveId, updates) => {
                Object.assign(store.get(cveId), {
                    status: updates.status ?? store.get(cveId).status,
                });
            }),
        };
    }

    test('acknowledges every open CVE in the selection', async () => {
        const cache = cacheOf([
            { cve_id: 'CVE-1', status: 'OPEN' },
            { cve_id: 'CVE-2', status: 'OPEN' },
        ]);

        const result = await batchVulnStatus(['CVE-1', 'CVE-2'], 'ACKNOWLEDGED', 'console', cache);

        expect(result.changed).toBe(2);
        expect(result.skipped).toBe(0);
        expect(result.changedIds).toEqual(['CVE-1', 'CVE-2']);
        expect(cache.store.get('CVE-1').status).toBe('ACKNOWLEDGED');
    });

    test('one CVE that cannot move does not stop the others', async () => {
        const cache = cacheOf([
            { cve_id: 'CVE-1', status: 'OPEN' },
            { cve_id: 'CVE-2', status: 'RESOLVED' },
            { cve_id: 'CVE-3', status: 'OPEN' },
        ]);

        const result = await batchVulnStatus(
            ['CVE-1', 'CVE-2', 'CVE-3'],
            'ACKNOWLEDGED',
            'console',
            cache
        );

        expect(result.changed).toBe(2);
        expect(result.skipped).toBe(1);
        expect(result.changedIds).toEqual(['CVE-1', 'CVE-3']);
    });

    test('the reason a CVE was skipped travels with it', async () => {
        const cache = cacheOf([{ cve_id: 'CVE-2', status: 'RESOLVED' }]);

        const { results } = await batchVulnStatus(['CVE-2'], 'ACKNOWLEDGED', 'console', cache);

        expect(results[0]).toMatchObject({ cveId: 'CVE-2', ok: false });
        expect(results[0].error).toMatch(/Invalid transition/);
    });

    test('a CVE that is not stored is reported, not thrown', async () => {
        const cache = cacheOf([]);

        const result = await batchVulnStatus(['CVE-NOPE'], 'RESOLVED', 'console', cache);

        expect(result.changed).toBe(0);
        expect(result.results[0].error).toMatch(/not found/);
    });

    test('resolving accepts an acknowledged CVE as well as an open one', async () => {
        const cache = cacheOf([
            { cve_id: 'CVE-1', status: 'OPEN' },
            { cve_id: 'CVE-2', status: 'ACKNOWLEDGED' },
        ]);

        const result = await batchVulnStatus(['CVE-1', 'CVE-2'], 'RESOLVED', 'console', cache);

        expect(result.changed).toBe(2);
    });

    // The whole reason acknowledgeVuln grew a `mitigate` option: fifty
    // acknowledgements must not be fifty model calls inside one request.
    test('acknowledging in batch runs no model', async () => {
        const cache = cacheOf([{ cve_id: 'CVE-1', status: 'OPEN' }]);

        const result = await batchVulnStatus(['CVE-1'], 'ACKNOWLEDGED', 'console', cache);

        expect(result.results[0].ok).toBe(true);
        // clientExplanation is what a mitigation guide would have written.
        for (const call of cache.update.mock.calls) {
            expect(call[1]).not.toHaveProperty('clientExplanation');
        }
    });
});
