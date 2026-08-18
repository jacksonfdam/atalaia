import { jest } from '@jest/globals';
import { acknowledgeVuln } from '../../../src/application/acknowledgeVuln.js';

describe('acknowledgeVuln', () => {
    /**
     * A cache that answers from a row it also applies updates to.
     *
     * It used to be a `get` sequenced with mockReturnValueOnce, which pinned the
     * test to how many times the function happened to read the row — so moving
     * the mitigation guide into its own module broke a test that was still
     * describing correct behaviour.
     */
    function createMockCache(vuln) {
        const row = { ...vuln };
        return {
            row,
            get: jest.fn(async () => ({ ...row })),
            update: jest.fn(async (_cveId, updates) => Object.assign(row, updates)),
        };
    }

    test('acknowledges an OPEN vulnerability', async () => {
        const cache = createMockCache({ cveId: 'CVE-2024-001', status: 'OPEN' });

        const result = await acknowledgeVuln('CVE-2024-001', 'tester', cache);
        expect(cache.update).toHaveBeenCalledWith('CVE-2024-001', expect.objectContaining({
            status: 'ACKNOWLEDGED',
            statusChangedBy: 'tester',
        }));
        expect(result.vuln.status).toBe('ACKNOWLEDGED');
    });

    test('throws for non-existent CVE', async () => {
        const cache = { get: jest.fn(() => null), update: jest.fn() };
        await expect(acknowledgeVuln('CVE-NONE', 'tester', cache)).rejects.toThrow('not found');
    });

    test('throws for invalid transition from RESOLVED', async () => {
        const cache = createMockCache({ cveId: 'CVE-2024-001', status: 'RESOLVED' });
        await expect(acknowledgeVuln('CVE-2024-001', 'tester', cache)).rejects.toThrow('Invalid transition');
    });

    // What a batch uses: a hundred acknowledgements must not be a hundred
    // model calls inside one request.
    test('mitigate:false changes the status and runs nothing else', async () => {
        const cache = createMockCache({ cveId: 'CVE-2024-001', status: 'OPEN' });

        const result = await acknowledgeVuln('CVE-2024-001', 'tester', cache, { mitigate: false });

        expect(result.vuln.status).toBe('ACKNOWLEDGED');
        expect(result.mitigation).toBeNull();
        for (const call of cache.update.mock.calls) {
            expect(call[1]).not.toHaveProperty('clientExplanation');
        }
    });
});
