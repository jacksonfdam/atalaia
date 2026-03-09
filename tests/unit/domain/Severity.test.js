import { jest } from '@jest/globals';
import { Severity, isValidSeverity, normalizeSeverity } from '../../../src/domain/enums/Severity.js';

describe('Severity Enum', () => {
    test('should have all severity levels', () => {
        expect(Severity.CRITICAL).toBe('CRITICAL');
        expect(Severity.HIGH).toBe('HIGH');
        expect(Severity.MEDIUM).toBe('MEDIUM');
        expect(Severity.LOW).toBe('LOW');
        expect(Severity.UNKNOWN).toBe('UNKNOWN');
    });

    test('isValidSeverity accepts valid values', () => {
        expect(isValidSeverity('CRITICAL')).toBe(true);
        expect(isValidSeverity('HIGH')).toBe(true);
        expect(isValidSeverity('MEDIUM')).toBe(true);
        expect(isValidSeverity('LOW')).toBe(true);
        expect(isValidSeverity('UNKNOWN')).toBe(true);
    });

    test('isValidSeverity rejects invalid values', () => {
        expect(isValidSeverity('INVALID')).toBe(false);
        expect(isValidSeverity('critical')).toBe(false);
    });

    test('normalizeSeverity normalizes case', () => {
        expect(normalizeSeverity('critical')).toBe('CRITICAL');
        expect(normalizeSeverity('High')).toBe('HIGH');
        expect(normalizeSeverity('MEDIUM')).toBe('MEDIUM');
    });

    test('normalizeSeverity returns UNKNOWN for invalid input', () => {
        expect(normalizeSeverity('invalid')).toBe('UNKNOWN');
        expect(normalizeSeverity(null)).toBe('UNKNOWN');
        expect(normalizeSeverity(undefined)).toBe('UNKNOWN');
        expect(normalizeSeverity('')).toBe('UNKNOWN');
    });
});
