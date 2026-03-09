import { jest } from '@jest/globals';
import { acknowledgeVuln } from '../../../src/application/acknowledgeVuln.js';

describe('acknowledgeVuln', () => {
    function createMockCache(vuln) {
        return {
            get: jest.fn(() => vuln),
            update: jest.fn(),
        };
    }

    test('acknowledges an OPEN vulnerability', async () => {
        const vuln = { cveId: 'CVE-2024-001', status: 'OPEN' };
        const cache = createMockCache(vuln);
        // get is called twice: once to check, once to return updated
        cache.get.mockReturnValueOnce(vuln).mockReturnValueOnce({ ...vuln, status: 'ACKNOWLEDGED' });

        const result = await acknowledgeVuln('CVE-2024-001', 'tester', cache);
        expect(cache.update).toHaveBeenCalledWith('CVE-2024-001', expect.objectContaining({
            status: 'ACKNOWLEDGED',
            statusChangedBy: 'tester',
        }));
        expect(result.status).toBe('ACKNOWLEDGED');
    });

    test('throws for non-existent CVE', async () => {
        const cache = { get: jest.fn(() => null), update: jest.fn() };
        await expect(acknowledgeVuln('CVE-NONE', 'tester', cache)).rejects.toThrow('not found');
    });

    test('throws for invalid transition from RESOLVED', async () => {
        const vuln = { cveId: 'CVE-2024-001', status: 'RESOLVED' };
        const cache = createMockCache(vuln);
        await expect(acknowledgeVuln('CVE-2024-001', 'tester', cache)).rejects.toThrow('Invalid transition');
    });
});
