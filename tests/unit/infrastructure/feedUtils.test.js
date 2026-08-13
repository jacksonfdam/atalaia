import { describe, test, expect } from '@jest/globals';

const { cvssToSeverity, extractCveId } = await import('#app/infrastructure/feeds/feedUtils.js');

describe('cvssToSeverity', () => {
    test.each([
        [9.8, 'Critical'],
        [9.0, 'Critical'],
        [7.0, 'High'],
        [6.9, 'Medium'],
        [4.0, 'Medium'],
        [0.1, 'Low'],
        [0, 'Unknown'],
        [null, 'Unknown'],
        ['not a number', 'Unknown'],
    ])('%s -> %s', (score, expected) => {
        expect(cvssToSeverity(score)).toBe(expected);
    });

    test('accepts a numeric string, which is how several feeds publish it', () => {
        expect(cvssToSeverity('8.1')).toBe('High');
    });
});

describe('extractCveId', () => {
    test('finds the CVE mentioned in prose', () => {
        expect(extractCveId('ZDI-26-563: something', 'Tracked as CVE-2026-18263.')).toBe('CVE-2026-18263');
    });

    test('takes the first source that has one', () => {
        expect(extractCveId(null, 'CVE-2026-0001', 'CVE-2026-0002')).toBe('CVE-2026-0001');
    });

    test('uppercases the match', () => {
        expect(extractCveId('cve-2026-0001')).toBe('CVE-2026-0001');
    });

    test('returns null when no source mentions one', () => {
        expect(extractCveId('CERTFR-2026-AVI-0562', undefined, null)).toBeNull();
    });
});
