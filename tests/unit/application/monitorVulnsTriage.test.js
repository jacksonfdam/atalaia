import { jest } from '@jest/globals';
import Vulnerability from '../../../src/domain/entities/Vulnerability.js';
import { partitionByAge, byAlertPriority } from '../../../src/application/monitorVulns.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function vuln(props) {
    return new Vulnerability({
        cveId: 'CVE-2026-0001',
        title: 'A vulnerability',
        description: 'Something is wrong',
        source: 'nvd',
        link: 'https://example.com',
        ...props,
    });
}

/** Days before now, as the ISO string a feed would hand over. */
function daysAgo(days) {
    return new Date(Date.now() - days * DAY_MS).toISOString();
}

describe('partitionByAge', () => {
    test('keeps an advisory published inside the window', () => {
        const { fresh, stale, undated } = partitionByAge([vuln({ publishedDate: daysAgo(2) })], 7);

        expect(fresh).toHaveLength(1);
        expect(stale).toHaveLength(0);
        expect(undated).toHaveLength(0);
    });

    test('discards the CISA KEV backlog', () => {
        // What actually reached Telegram: the whole catalogue is served on every
        // fetch, dateAdded and all.
        const kev = vuln({ publishedDate: '2021-11-03', source: 'cisa', exploited: true });
        const { fresh, stale } = partitionByAge([kev], 7);

        expect(fresh).toHaveLength(0);
        expect(stale).toEqual([kev]);
    });

    test('counts an undated advisory as neither fresh nor stale', () => {
        const { fresh, stale, undated } = partitionByAge([vuln({ publishedDate: null })], 7);

        expect(fresh).toHaveLength(0);
        expect(stale).toHaveLength(0);
        expect(undated).toHaveLength(1);
    });

    test('an unparseable date is undated, not today', () => {
        const { fresh, undated } = partitionByAge([vuln({ publishedDate: 'not a date' })], 7);

        expect(fresh).toHaveLength(0);
        expect(undated).toHaveLength(1);
    });

    test('the boundary is inclusive', () => {
        const { fresh } = partitionByAge([vuln({ publishedDate: daysAgo(6.99) })], 7);
        expect(fresh).toHaveLength(1);
    });

    test('zero disables the cutoff', () => {
        const old = vuln({ publishedDate: '2015-01-01' });
        const { fresh, stale, undated } = partitionByAge([old], 0);

        expect(fresh).toEqual([old]);
        expect(stale).toHaveLength(0);
        expect(undated).toHaveLength(0);
    });
});

describe('byAlertPriority', () => {
    test('an exploited advisory outranks a critical one', () => {
        const exploited = vuln({ severity: 'MEDIUM', exploited: true });
        const critical = vuln({ severity: 'CRITICAL' });

        expect([critical, exploited].sort(byAlertPriority)[0]).toBe(exploited);
    });

    test('severity decides between two unexploited advisories', () => {
        const high = vuln({ severity: 'HIGH' });
        const low = vuln({ severity: 'LOW' });

        expect([low, high].sort(byAlertPriority)[0]).toBe(high);
    });

    test('the higher CVSS score wins within one severity', () => {
        const worse = vuln({ severity: 'HIGH', cvssScore: 8.9 });
        const better = vuln({ severity: 'HIGH', cvssScore: 7.1 });

        expect([better, worse].sort(byAlertPriority)[0]).toBe(worse);
    });

    test('the newer advisory wins when everything else ties', () => {
        const newer = vuln({ severity: 'HIGH', cvssScore: 8, publishedDate: daysAgo(1) });
        const older = vuln({ severity: 'HIGH', cvssScore: 8, publishedDate: daysAgo(5) });

        expect([older, newer].sort(byAlertPriority)[0]).toBe(newer);
    });

    test('an unknown severity sorts last', () => {
        const unknown = vuln({ severity: 'garbage' });
        const low = vuln({ severity: 'LOW' });

        expect([unknown, low].sort(byAlertPriority)[1]).toBe(unknown);
    });
});
