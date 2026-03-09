import { Status } from '../domain/enums/Status.js';

const SEVERITY_ORDER = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

/**
 * Generate a weekly vulnerability report from cached vulnerabilities.
 * Only includes OPEN and ACKNOWLEDGED vulns, grouped by severity.
 * @param {Array} vulnerabilities - All cached vulnerabilities
 * @returns {object|null} Report data or null if no vulns to report
 */
export function generateWeeklyReport(vulnerabilities) {
    const filtered = vulnerabilities.filter(
        v => v.status === Status.OPEN || v.status === Status.ACKNOWLEDGED
    );

    if (filtered.length === 0) return null;

    const grouped = {};
    SEVERITY_ORDER.forEach(s => { grouped[s] = []; });

    for (const v of filtered) {
        const key = (v.severity || '').toUpperCase();
        if (grouped[key]) {
            grouped[key].push(v);
        }
    }

    return {
        generatedAt: new Date().toISOString(),
        totalCount: filtered.length,
        vulnerabilities: grouped,
    };
}
