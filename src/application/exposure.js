import logger from '../infrastructure/logger.js';
import { candidateLinks, advisoryPackagesFor, getRepositoriesByIds } from '../infrastructure/cache/repositoryStore.js';
import { openCount } from '../infrastructure/cache/postgresCache.js';
import { evaluateMatch } from './advisoryMatch.js';

/**
 * Which CVE really reaches which repository.
 *
 * The store answers the cheap half: every (CVE, dependency) pair that shares a
 * name. This is the other half — asking, per pair, whether the version the
 * repository declares is one the advisory says is affected — and the only place
 * that answers it. The exposure list, the counts and filters, the reports, the
 * relevance counters and the alerts all read through here, so the number in a
 * header can never disagree with the rows under it.
 *
 * A pair leaves the result only on a proven `unaffected`. `affected` and
 * `unverified` stay, and say which they are.
 */

const INFRASTRUCTURE = new Set(['DOCKER', 'GITHUB_ACTIONS', 'TERRAFORM', 'HELM']);

let reportedClearance = false;

/**
 * @typedef {object} Link
 * @property {'affected'|'unverified'} verdict
 * @property {string|null} reason      Why it could not be verified
 * @property {string|null} patchedIn   First patched version(s), when the advisory says
 */

/**
 * The candidates, judged, with the cleared ones removed.
 *
 * @param {Parameters<typeof candidateLinks>[0]} [options]
 * @returns {Promise<(object & Link)[]>} rows as `candidateLinks()` returns them, plus the verdict
 */
async function evaluatedLinks(options = {}) {
    const candidates = await candidateLinks(options);
    const advisories = await advisoryPackagesFor([...new Set(candidates.map(row => row.vulnerability_id))]);

    // A dependency can match one CVE twice: by its own name and by the OpenCVE
    // product it maps to. The name is the package; the product is a guess about
    // it. When both exist, the name decides.
    const named = new Set(
        candidates.filter(row => row.match_kind === 'name').map(row => `${row.vulnerability_id}:${row.dependency_id}`)
    );

    const kept = [];
    const cleared = {};

    for (const row of candidates) {
        const key = `${row.vulnerability_id}:${row.dependency_id}`;
        if (row.match_kind === 'vendor_product' && named.has(key)) continue;

        const result = evaluateMatch(
            {
                ecosystem: row.ecosystem,
                name: row.dependency,
                version: row.version,
                versions: row.versions,
                matchKind: row.match_kind,
            },
            advisories.get(row.vulnerability_id) ?? []
        );

        if (result.verdict === 'unaffected') {
            cleared[row.ecosystem] = (cleared[row.ecosystem] ?? 0) + 1;
            continue;
        }

        kept.push({ ...row, verdict: result.verdict, reason: result.reason, patchedIn: result.patchedIn });
    }

    // Said once per process, at the first fleet-wide read: how many findings the
    // version check removed, so the effect of switching it on can be checked
    // against the repositories it is about rather than taken on trust.
    if (!reportedClearance && options.repositoryId == null && options.cveId == null) {
        reportedClearance = true;
        logger.info(
            { candidates: candidates.length, kept: kept.length, clearedByEcosystem: cleared },
            'Version check applied to the CVE-to-dependency matches'
        );
    }

    return kept;
}

/**
 * Per CVE, the verdict that counts: confirmed if any dependency is affected.
 * @param {Link[]} rows
 */
function worstVerdict(rows) {
    return rows.some(row => row.verdict === 'affected') ? 'affected' : 'unverified';
}

/**
 * What reaches one repository, one row per (CVE, matching dependency).
 *
 * @param {number} repositoryId
 * @param {{ includeResolved?: boolean }} [options]
 */
export function vulnerabilitiesForRepository(repositoryId, { includeResolved = false } = {}) {
    return evaluatedLinks({ repositoryId, includeResolved });
}

/**
 * Which CVE reaches which enabled repository, for the reports.
 *
 * @param {{ since?: string, includeResolved?: boolean }} [options]
 */
export function repositoryLinks({ since = null, includeResolved = false } = {}) {
    return evaluatedLinks({ enabledOnly: true, since, includeResolved });
}

/**
 * How exposed every repository is, in one pass.
 *
 * `total` counts every CVE that stays — confirmed or not — because that is what
 * the exposure filter, the sort and the "at risk" header are made of.
 *
 * @returns {Promise<Map<number, { total: number, confirmed: number, unverified: number, bySeverity: Record<string, number>, exploited: boolean }>>}
 */
export async function repositoryExposure() {
    const links = await evaluatedLinks();

    const byRepo = new Map();
    const perCve = new Map();

    for (const link of links) {
        const key = `${link.repository_id}:${link.cve_id}`;
        const group = perCve.get(key) ?? [];
        group.push(link);
        perCve.set(key, group);
    }

    for (const group of perCve.values()) {
        const first = group[0];
        const entry = byRepo.get(first.repository_id) ?? {
            total: 0,
            confirmed: 0,
            unverified: 0,
            bySeverity: {},
            exploited: false,
        };

        entry.total += 1;
        entry[worstVerdict(group) === 'affected' ? 'confirmed' : 'unverified'] += 1;
        entry.bySeverity[first.severity ?? 'UNKNOWN'] = (entry.bySeverity[first.severity ?? 'UNKNOWN'] ?? 0) + 1;
        entry.exploited = entry.exploited || Boolean(first.exploited);
        byRepo.set(first.repository_id, entry);
    }

    return byRepo;
}

/**
 * Open CVEs that reach something the fleet runs, for the relevance filter and
 * its counters. Only repositories that are switched on count.
 *
 * @param {'affecting'|'infrastructure'} kind
 * @returns {Promise<number[]>} vulnerability ids
 */
export async function relevantVulnerabilityIds(kind) {
    const links = await evaluatedLinks({ enabledOnly: true });

    const matching = kind === 'infrastructure' ? links.filter(link => INFRASTRUCTURE.has(link.ecosystem)) : links;

    return [...new Set(matching.map(link => link.vulnerability_id))];
}

/**
 * The numbers behind the Vulnerabilities header: how much of the database is
 * about this fleet.
 */
export async function relevanceSummary() {
    const [total, affecting, infrastructure] = await Promise.all([
        openCount(),
        relevantVulnerabilityIds('affecting'),
        relevantVulnerabilityIds('infrastructure'),
    ]);

    return { total, affecting: affecting.length, infrastructure: infrastructure.length };
}

/**
 * Repositories a stored vulnerability really reaches — the alert's audience.
 * Only a proven `unaffected` is left out; an unverified match still pages.
 *
 * @param {string} cveId
 * @returns {Promise<object[]>} repository rows
 */
export async function repositoriesReachedBy(cveId) {
    const links = await evaluatedLinks({ cveId, enabledOnly: true });
    return getRepositoriesByIds([...new Set(links.map(link => link.repository_id))]);
}
