import { getRepository } from '../infrastructure/cache/repositoryStore.js';
import { vulnerabilitiesForRepository, repositoryExposure } from './exposure.js';

/**
 * What a repository is exposed to.
 *
 * The monitoring cycle already answers the question from the other side —
 * "which repositories does this CVE touch" — to decide who gets alerted. This
 * is the same relation read from the repository, which is the direction an
 * engineer actually asks it in: what is wrong with mine, and where.
 */

const SEVERITY_ORDER = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'];

function hydrate(row) {
    return {
        cveId: row.cve_id,
        title: row.title,
        severity: row.severity ?? 'UNKNOWN',
        cvssScore: row.cvss_score,
        exploited: row.exploited,
        status: row.status,
        source: row.source,
        firstSeenAt: row.first_seen_at,
    };
}

/** The worst severity present, for a one-glance badge. */
export function worstSeverity(bySeverity = {}) {
    return SEVERITY_ORDER.find(severity => (bySeverity[severity] ?? 0) > 0) ?? null;
}

/**
 * @param {number} repositoryId
 * @param {{ includeResolved?: boolean }} [options]
 */
export async function getRepositoryVulnerabilities(repositoryId, options = {}) {
    const repo = await getRepository(repositoryId);
    if (!repo) return null;

    const rows = await vulnerabilitiesForRepository(repositoryId, options);

    // One row per (CVE, matching dependency): the same CVE can arrive through
    // two packages, and knowing which manifest to open is the point.
    const byCve = new Map();

    for (const row of rows) {
        const entry = byCve.get(row.cve_id) ?? { ...hydrate(row), matches: [] };

        entry.matches.push({
            dependency: row.dependency,
            ecosystem: row.ecosystem,
            version: row.version,
            manifestFile: row.manifest_file,
            // Whether the advisory is proven to reach this version, or could not
            // be checked (and why), and what first fixes it.
            verdict: row.verdict,
            reason: row.reason,
            patchedIn: row.patchedIn,
        });

        byCve.set(row.cve_id, entry);
    }

    const vulnerabilities = [...byCve.values()];
    for (const vuln of vulnerabilities) {
        vuln.verdict = vuln.matches.some(match => match.verdict === 'affected') ? 'affected' : 'unverified';
    }

    const bySeverity = {};
    for (const vuln of vulnerabilities) {
        bySeverity[vuln.severity] = (bySeverity[vuln.severity] ?? 0) + 1;
    }

    return {
        repository: { id: repo.id, name: repo.name, url: repo.url, enabled: repo.enabled },
        count: vulnerabilities.length,
        confirmed: vulnerabilities.filter(vuln => vuln.verdict === 'affected').length,
        unverified: vulnerabilities.filter(vuln => vuln.verdict === 'unverified').length,
        exploited: vulnerabilities.filter(vuln => vuln.exploited).length,
        bySeverity,
        worst: worstSeverity(bySeverity),
        vulnerabilities,
    };
}

/**
 * Exposure for every repository at once, keyed by id.
 * @returns {Map<number, { total: number, bySeverity: Record<string, number>, exploited: number, worst: string|null }>}
 */
export async function summarizeFleetRisk() {
    const summary = await repositoryExposure();

    for (const [, entry] of summary) {
        entry.worst = worstSeverity(entry.bySeverity);
        entry.exploited = Boolean(entry.exploited);
    }

    return summary;
}
