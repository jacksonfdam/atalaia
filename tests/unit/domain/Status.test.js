import { jest } from '@jest/globals';
import { Status, isValidStatus, isValidTransition } from '../../../src/domain/enums/Status.js';

describe('Status Enum', () => {
    test('should have OPEN, ACKNOWLEDGED, RESOLVED values', () => {
        expect(Status.OPEN).toBe('OPEN');
        expect(Status.ACKNOWLEDGED).toBe('ACKNOWLEDGED');
        expect(Status.RESOLVED).toBe('RESOLVED');
    });

    test('should be frozen (immutable)', () => {
        expect(Object.isFrozen(Status)).toBe(true);
    });

    test('isValidStatus accepts valid values', () => {
        expect(isValidStatus('OPEN')).toBe(true);
        expect(isValidStatus('ACKNOWLEDGED')).toBe(true);
        expect(isValidStatus('RESOLVED')).toBe(true);
    });

    test('isValidStatus rejects invalid values', () => {
        expect(isValidStatus('INVALID')).toBe(false);
        expect(isValidStatus(null)).toBe(false);
        expect(isValidStatus('')).toBe(false);
    });

    test('isValidTransition allows OPEN → ACKNOWLEDGED', () => {
        expect(isValidTransition('OPEN', 'ACKNOWLEDGED')).toBe(true);
    });

    test('isValidTransition allows OPEN → RESOLVED', () => {
        expect(isValidTransition('OPEN', 'RESOLVED')).toBe(true);
    });

    test('isValidTransition allows ACKNOWLEDGED → RESOLVED', () => {
        expect(isValidTransition('ACKNOWLEDGED', 'RESOLVED')).toBe(true);
    });

    test('isValidTransition blocks RESOLVED → any', () => {
        expect(isValidTransition('RESOLVED', 'OPEN')).toBe(false);
        expect(isValidTransition('RESOLVED', 'ACKNOWLEDGED')).toBe(false);
    });

    test('isValidTransition blocks ACKNOWLEDGED → OPEN', () => {
        expect(isValidTransition('ACKNOWLEDGED', 'OPEN')).toBe(false);
    });
});
