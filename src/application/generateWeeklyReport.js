import { Status } from '../domain/enums/Status.js';

/**
 * UNKNOWN is a bucket like any other. Sources such as Ubuntu USN and CERT-FR
 * publish no score at all, so dropping unrated items would silently hide a
 * third of the report — the count in the header would not match the list.
 */
const SEVERITY_ORDER = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'];

const DEFAULT_WINDOW_DAYS = 7;
const MS_PER_DAY = 86_400_000;

/** Rows come from SQLite (snake_case) or straight from the entity (camelCase). */
function firstSeen(vuln) {
    const raw = vuln.first_seen_at ?? vuln.firstSeenAt ?? vuln.publishedDate ?? null;
    if (!raw) return null;

    // SQLite writes "2026-08-13 09:48:27" — space-separated and in UTC.
    const parsed = new Date(typeof raw === 'string' ? raw.replace(' ', 'T') : raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function countBySeverity(vulns) {
    const counts = {};
    for (const severity of SEVERITY_ORDER) counts[severity] = 0;

    for (const vuln of vulns) {
        const key = (vuln.severity || 'UNKNOWN').toUpperCase();
        counts[key in counts ? key : 'UNKNOWN'] += 1;
    }
    return counts;
}

/**
 * Generate the weekly vulnerability digest.
 *
 * The body is what was *detected in the window* — that is what makes the email
 * weekly. Everything still open is reported alongside as a running total, so a
 * quiet week reads as "nothing new, 113 still open" instead of re-sending the
 * whole backlog every Monday.
 *
 * @param {Array} vulnerabilities All cached vulnerabilities
 * @param {{ windowDays?: number, now?: Date|string }} [options]
 * @returns {object|null} Report data, or null when nothing is open at all
 */
export function generateWeeklyReport(vulnerabilities, options = {}) {
    const windowDays = options.windowDays ?? DEFAULT_WINDOW_DAYS;
    const now = options.now ? new Date(options.now) : new Date();
    const since = new Date(now.getTime() - windowDays * MS_PER_DAY);

    const open = vulnerabilities.filter(
        v => v.status === Status.OPEN || v.status === Status.ACKNOWLEDGED
    );

    if (open.length === 0) return null;

    // A row with no usable timestamp counts as new: it cannot be shown to be
    // older than the window, and leaving it out would hide it forever.
    const fresh = open.filter(vuln => {
        const seen = firstSeen(vuln);
        return seen === null || seen >= since;
    });

    const grouped = {};
    for (const severity of SEVERITY_ORDER) grouped[severity] = [];

    for (const vuln of fresh) {
        const key = (vuln.severity || 'UNKNOWN').toUpperCase();
        grouped[key in grouped ? key : 'UNKNOWN'].push(vuln);
    }

    return {
        generatedAt: now.toISOString(),
        windowDays,
        since: since.toISOString(),
        // What the body lists: this window's detections.
        totalCount: fresh.length,
        vulnerabilities: grouped,
        // The running backlog, for context in the header.
        openTotal: open.length,
        openBySeverity: countBySeverity(open),
    };
}
