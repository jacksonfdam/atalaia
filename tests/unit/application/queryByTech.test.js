import { jest } from '@jest/globals';
import { queryByTech } from '../../../src/application/queryByTech.js';

describe('queryByTech', () => {
    const mockCache = {
        getAll: () => [
            { cveId: 'CVE-1', affectedTechnologies: ['react'], status: 'OPEN' },
            { cveId: 'CVE-2', affectedTechnologies: ['node.js'], status: 'RESOLVED' },
            { cveId: 'CVE-3', affectedTechnologies: ['react', 'node.js'], status: 'OPEN' },
            { cveId: 'CVE-4', affectedTechnologies: ['docker'], status: 'ACKNOWLEDGED' },
        ],
    };

    test('finds vulns matching technology', () => {
        const results = queryByTech(['react'], mockCache);
        expect(results).toHaveLength(2);
        expect(results.map(r => r.cveId)).toEqual(['CVE-1', 'CVE-3']);
    });

    test('excludes RESOLVED vulns', () => {
        const results = queryByTech(['node.js'], mockCache);
        expect(results).toHaveLength(1);
        expect(results[0].cveId).toBe('CVE-3');
    });

    test('includes ACKNOWLEDGED vulns', () => {
        const results = queryByTech(['docker'], mockCache);
        expect(results).toHaveLength(1);
        expect(results[0].cveId).toBe('CVE-4');
    });

    test('is case-insensitive', () => {
        const results = queryByTech(['REACT'], mockCache);
        expect(results).toHaveLength(2);
    });

    test('returns empty array for no matches', () => {
        const results = queryByTech(['python'], mockCache);
        expect(results).toEqual([]);
    });

    test('handles multiple technologies with OR logic', () => {
        const results = queryByTech(['react', 'docker'], mockCache);
        expect(results).toHaveLength(3);
    });
});
