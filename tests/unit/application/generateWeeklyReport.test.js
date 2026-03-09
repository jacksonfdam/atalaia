import { jest } from '@jest/globals';
import { generateWeeklyReport } from '../../../src/application/generateWeeklyReport.js';

describe('generateWeeklyReport', () => {
    test('returns null for empty array', () => {
        expect(generateWeeklyReport([])).toBeNull();
    });

    test('returns null when all vulns are RESOLVED', () => {
        const vulns = [
            { cveId: 'CVE-1', severity: 'HIGH', status: 'RESOLVED' },
            { cveId: 'CVE-2', severity: 'LOW', status: 'RESOLVED' },
        ];
        expect(generateWeeklyReport(vulns)).toBeNull();
    });

    test('includes OPEN vulns', () => {
        const vulns = [{ cveId: 'CVE-1', severity: 'CRITICAL', status: 'OPEN' }];
        const report = generateWeeklyReport(vulns);
        expect(report).not.toBeNull();
        expect(report.vulnerabilities.CRITICAL).toHaveLength(1);
    });

    test('includes ACKNOWLEDGED vulns', () => {
        const vulns = [{ cveId: 'CVE-1', severity: 'HIGH', status: 'ACKNOWLEDGED' }];
        const report = generateWeeklyReport(vulns);
        expect(report.vulnerabilities.HIGH).toHaveLength(1);
    });

    test('groups by severity correctly', () => {
        const vulns = [
            { cveId: 'CVE-1', severity: 'CRITICAL', status: 'OPEN' },
            { cveId: 'CVE-2', severity: 'HIGH', status: 'OPEN' },
            { cveId: 'CVE-3', severity: 'CRITICAL', status: 'ACKNOWLEDGED' },
            { cveId: 'CVE-4', severity: 'LOW', status: 'RESOLVED' },
        ];
        const report = generateWeeklyReport(vulns);
        expect(report.totalCount).toBe(3);
        expect(report.vulnerabilities.CRITICAL).toHaveLength(2);
        expect(report.vulnerabilities.HIGH).toHaveLength(1);
        expect(report.vulnerabilities.LOW).toHaveLength(0);
    });

    test('includes generatedAt timestamp', () => {
        const vulns = [{ cveId: 'CVE-1', severity: 'HIGH', status: 'OPEN' }];
        const report = generateWeeklyReport(vulns);
        expect(report.generatedAt).toBeTruthy();
        expect(new Date(report.generatedAt).getTime()).not.toBeNaN();
    });
});
