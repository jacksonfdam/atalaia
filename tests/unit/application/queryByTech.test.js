import { jest } from '@jest/globals';
import { queryByTech } from '../../../src/application/queryByTech.js';

describe('queryByTech', () => {
    const mockCache = {
        getAll: async () => [
            { cveId: 'CVE-1', affectedTechnologies: ['react'], status: 'OPEN' },
            { cveId: 'CVE-2', affectedTechnologies: ['node.js'], status: 'RESOLVED' },
            { cveId: 'CVE-3', affectedTechnologies: ['react', 'node.js'], status: 'OPEN' },
            { cveId: 'CVE-4', affectedTechnologies: ['docker'], status: 'ACKNOWLEDGED' },
        ],
    };

    test('finds vulns matching technology', async () => {
        const results = await queryByTech(['react'], mockCache);
        expect(results).toHaveLength(2);
        expect(results.map(r => r.cveId)).toEqual(['CVE-1', 'CVE-3']);
    });

    test('excludes RESOLVED vulns', async () => {
        const results = await queryByTech(['node.js'], mockCache);
        expect(results).toHaveLength(1);
        expect(results[0].cveId).toBe('CVE-3');
    });

    test('includes ACKNOWLEDGED vulns', async () => {
        const results = await queryByTech(['docker'], mockCache);
        expect(results).toHaveLength(1);
        expect(results[0].cveId).toBe('CVE-4');
    });

    test('is case-insensitive', async () => {
        const results = await queryByTech(['REACT'], mockCache);
        expect(results).toHaveLength(2);
    });

    test('returns empty array for no matches', async () => {
        const results = await queryByTech(['python'], mockCache);
        expect(results).toEqual([]);
    });

    test('handles multiple technologies with OR logic', async () => {
        const results = await queryByTech(['react', 'docker'], mockCache);
        expect(results).toHaveLength(3);
    });
});
