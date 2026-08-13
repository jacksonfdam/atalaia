import { generateWeeklyReport } from '../../../src/application/generateWeeklyReport.js';

const NOW = '2026-08-13T09:00:00.000Z';

/** Days before NOW, in the space-separated shape SQLite stores. */
function daysAgo(days) {
    return new Date(Date.parse(NOW) - days * 86_400_000).toISOString().replace('T', ' ').slice(0, 19);
}

function report(vulns, options = {}) {
    return generateWeeklyReport(vulns, { now: NOW, ...options });
}

describe('generateWeeklyReport', () => {
    test('returns null for empty array', () => {
        expect(report([])).toBeNull();
    });

    test('returns null when all vulns are RESOLVED', () => {
        const vulns = [
            { cveId: 'CVE-1', severity: 'HIGH', status: 'RESOLVED' },
            { cveId: 'CVE-2', severity: 'LOW', status: 'RESOLVED' },
        ];
        expect(report(vulns)).toBeNull();
    });

    test('includes OPEN vulns', () => {
        const result = report([{ cveId: 'CVE-1', severity: 'CRITICAL', status: 'OPEN' }]);
        expect(result).not.toBeNull();
        expect(result.vulnerabilities.CRITICAL).toHaveLength(1);
    });

    test('includes ACKNOWLEDGED vulns', () => {
        const result = report([{ cveId: 'CVE-1', severity: 'HIGH', status: 'ACKNOWLEDGED' }]);
        expect(result.vulnerabilities.HIGH).toHaveLength(1);
    });

    test('groups by severity correctly', () => {
        const result = report([
            { cveId: 'CVE-1', severity: 'CRITICAL', status: 'OPEN' },
            { cveId: 'CVE-2', severity: 'HIGH', status: 'OPEN' },
            { cveId: 'CVE-3', severity: 'CRITICAL', status: 'ACKNOWLEDGED' },
            { cveId: 'CVE-4', severity: 'LOW', status: 'RESOLVED' },
        ]);

        expect(result.totalCount).toBe(3);
        expect(result.vulnerabilities.CRITICAL).toHaveLength(2);
        expect(result.vulnerabilities.HIGH).toHaveLength(1);
        expect(result.vulnerabilities.LOW).toHaveLength(0);
    });

    test('includes generatedAt timestamp', () => {
        const result = report([{ cveId: 'CVE-1', severity: 'HIGH', status: 'OPEN' }]);
        expect(new Date(result.generatedAt).getTime()).not.toBeNaN();
    });
});

describe('the seven-day window', () => {
    const vulns = [
        { cve_id: 'CVE-NEW', severity: 'HIGH', status: 'OPEN', first_seen_at: daysAgo(2) },
        { cve_id: 'CVE-EDGE', severity: 'LOW', status: 'OPEN', first_seen_at: daysAgo(6.9) },
        { cve_id: 'CVE-OLD', severity: 'CRITICAL', status: 'OPEN', first_seen_at: daysAgo(30) },
        { cve_id: 'CVE-ANCIENT', severity: 'HIGH', status: 'ACKNOWLEDGED', first_seen_at: daysAgo(400) },
    ];

    test('lists only what was detected inside the window', () => {
        const result = report(vulns);

        expect(result.totalCount).toBe(2);
        expect(result.vulnerabilities.HIGH.map(v => v.cve_id)).toEqual(['CVE-NEW']);
        expect(result.vulnerabilities.LOW.map(v => v.cve_id)).toEqual(['CVE-EDGE']);
        expect(result.vulnerabilities.CRITICAL).toHaveLength(0);
    });

    test('reports the whole backlog alongside it', () => {
        const result = report(vulns);

        expect(result.openTotal).toBe(4);
        expect(result.openBySeverity).toEqual({ CRITICAL: 1, HIGH: 2, MEDIUM: 0, LOW: 1, UNKNOWN: 0 });
    });

    test('honours a custom window', () => {
        expect(report(vulns, { windowDays: 60 }).totalCount).toBe(3);
    });

    test('still reports when nothing is new but something is open', () => {
        const result = report([vulns[2]]);

        expect(result.totalCount).toBe(0);
        expect(result.openTotal).toBe(1);
    });

    test('keeps a row whose timestamp is missing or unparseable', () => {
        const result = report([
            { cve_id: 'CVE-NO-DATE', severity: 'HIGH', status: 'OPEN' },
            { cve_id: 'CVE-BAD-DATE', severity: 'HIGH', status: 'OPEN', first_seen_at: 'not a date' },
        ]);

        expect(result.totalCount).toBe(2);
    });

    test('reads camelCase timestamps too', () => {
        const result = report([
            { cveId: 'CVE-1', severity: 'HIGH', status: 'OPEN', firstSeenAt: daysAgo(30) },
        ]);

        expect(result.totalCount).toBe(0);
    });
});

describe('unrated vulnerabilities', () => {
    test('are listed instead of dropped between the total and the table', () => {
        const result = report([
            { cve_id: 'CVE-1', severity: 'UNKNOWN', status: 'OPEN' },
            { cve_id: 'CVE-2', severity: '', status: 'OPEN' },
            { cve_id: 'CVE-3', severity: 'NONSENSE', status: 'OPEN' },
        ]);

        expect(result.totalCount).toBe(3);
        expect(result.vulnerabilities.UNKNOWN).toHaveLength(3);
    });
});
