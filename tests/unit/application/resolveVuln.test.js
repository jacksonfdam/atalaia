import { jest } from '@jest/globals';
import { resolveVuln } from '../../../src/application/resolveVuln.js';

describe('resolveVuln', () => {
    function createMockCache(vuln) {
        return {
            get: jest.fn(() => vuln),
            update: jest.fn(),
        };
    }

    test('resolves an OPEN vulnerability', async () => {
        const vuln = { cveId: 'CVE-2024-001', status: 'OPEN' };
        const cache = createMockCache(vuln);
        cache.get.mockReturnValueOnce(vuln).mockReturnValueOnce({ ...vuln, status: 'RESOLVED' });

        const result = await resolveVuln('CVE-2024-001', 'tester', cache);
        expect(cache.update).toHaveBeenCalledWith('CVE-2024-001', expect.objectContaining({
            status: 'RESOLVED',
            statusChangedBy: 'tester',
        }));
        expect(result.status).toBe('RESOLVED');
    });

    test('resolves an ACKNOWLEDGED vulnerability', async () => {
        const vuln = { cveId: 'CVE-2024-001', status: 'ACKNOWLEDGED' };
        const cache = createMockCache(vuln);
        cache.get.mockReturnValueOnce(vuln).mockReturnValueOnce({ ...vuln, status: 'RESOLVED' });

        const result = await resolveVuln('CVE-2024-001', 'tester', cache);
        expect(result.status).toBe('RESOLVED');
    });

    test('throws for non-existent CVE', async () => {
        const cache = { get: jest.fn(() => null), update: jest.fn() };
        await expect(resolveVuln('CVE-NONE', 'tester', cache)).rejects.toThrow('not found');
    });
});
