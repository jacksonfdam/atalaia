import { Status } from '../domain/enums/Status.js';
import { compareVersions } from './versionComparison.js';
import { shortVersion } from '../infrastructure/notifiers/shortVersion.js';
import { toDate } from '../infrastructure/db/pool.js';

/**
 * The weekly digest.
 *
 * The body is what was *detected in the window* — that is what makes it weekly.
 * Everything still open is reported alongside as a running total, so a quiet
 * week reads as "nothing new, 113 still open" instead of re-sending the whole
 * backlog every Monday.
 *
 * It is split the way the console splits it, because a report that disagrees
 * with the screen is worse than no report: the digest used to list every row
 * ever collected — thousands — while the console led with the twenty-seven that
 * name something the fleet ships.
 *
 *   affecting        the CVE names a dependency of a tracked, enabled repository
 *   infrastructure   it only reaches a container image or a CI action
 *   other            everything else collected
 *
 * Only `affecting` is grouped by repository: the other two are by definition the
 * ones that reach none.
 */

/**
 * UNKNOWN is a bucket like any other. Sources such as Ubuntu USN and CERT-FR
 * publish no score at all, so dropping unrated items would silently hide a
 * third of the report — the count in the header would not match the list.
 */
const SEVERITY_ORDER = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'];
const SEVERITY_RANK = Object.fromEntries(SEVERITY_ORDER.map((s, i) => [s, SEVERITY_ORDER.length - i]));

const DEFAULT_WINDOW_DAYS = 7;
const MS_PER_DAY = 86_400_000;

/**
 * How many rows the two ungrouped sections list.
 *
 * "Everything else collected" is thousands of rows on a real install. An email
 * that lists them is not a report, it is a database dump — so they are capped
 * and the full count is stated next to them.
 */
const SECTION_LIMIT = 25;

/** Ecosystems that are infrastructure rather than application code. */
const INFRASTRUCTURE_ECOSYSTEMS = new Set(['DOCKER', 'GITHUB_ACTIONS', 'TERRAFORM', 'HELM']);

/**
 * Rows arrive from the database (snake_case) or straight from the entity.
 *
 * Parsed by toDate rather than by hand: `new Date(raw.replace(' ', 'T'))` gave
 * Invalid Date for every single database row, because Postgres writes the
 * offset as `+00` and V8 wants `+00:00`. Every one of them therefore had no
 * usable timestamp, took the "counts as new" branch below, and the weekly
 * digest listed the entire open backlog every week instead of the window.
 */
function firstSeen(vuln) {
    return toDate(vuln.first_seen_at ?? vuln.firstSeenAt ?? vuln.publishedDate ?? null);
}

function severityOf(vuln) {
    const key = (vuln.severity || 'UNKNOWN').toUpperCase();
    return key in SEVERITY_RANK ? key : 'UNKNOWN';
}

function countBySeverity(vulns) {
    const counts = Object.fromEntries(SEVERITY_ORDER.map(s => [s, 0]));
    for (const vuln of vulns) counts[severityOf(vuln)] += 1;
    return counts;
}

/** The shape every section lists a vulnerability in. */
function present(vuln) {
    return {
        cveId: vuln.cve_id ?? vuln.cveId,
        title: vuln.title ?? null,
        severity: severityOf(vuln),
        cvssScore: vuln.cvss_score ?? vuln.cvssScore ?? null,
        exploited: Boolean(vuln.exploited),
        status: vuln.status ?? Status.OPEN,
        source: vuln.source ?? null,
        sourceUrl: vuln.source_url ?? vuln.link ?? null,
        ...summarize(vuln),
    };
}

/**
 * The short version, for someone who does not read CVSS vectors for a living.
 */
function summarize(vuln) {
    return { explanation: shortVersion(vuln, 280)?.text ?? null };
}

function bySeverityThenScore(a, b) {
    const rank = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    if (rank !== 0) return rank;
    return (b.cvssScore ?? 0) - (a.cvssScore ?? 0);
}

/** Cap a section, and say what was left out rather than quietly dropping it. */
function capped(vulns, limit = SECTION_LIMIT) {
    const sorted = [...vulns].sort(bySeverityThenScore);
    return {
        count: sorted.length,
        shown: Math.min(sorted.length, limit),
        vulnerabilities: sorted.slice(0, limit),
    };
}

/**
 * Group the links into repositories, each with the CVEs that reach it and the
 * dependencies they arrive through.
 */
function groupByRepository(links, presented) {
    const repositories = new Map();

    for (const link of links) {
        const vuln = presented.get(link.cve_id);
        if (!vuln) continue; // outside the window, or resolved

        let repo = repositories.get(link.repository_id);
        if (!repo) {
            repo = {
                id: link.repository_id,
                name: link.repository_name,
                url: link.repository_url,
                worstSeverity: null,
                vulnerabilities: new Map(),
            };
            repositories.set(link.repository_id, repo);
        }

        let entry = repo.vulnerabilities.get(link.cve_id);
        if (!entry) {
            entry = { ...vuln, via: [] };
            repo.vulnerabilities.set(link.cve_id, entry);
        }

        // One CVE can arrive through several dependencies — a Docker image and a
        // package with the same name, say — and each is a different file to open.
        const already = entry.via.some(
            v => v.dependency === link.dependency && v.manifestFile === link.manifest_file
        );
        if (!already) {
            entry.via.push({
                dependency: link.dependency,
                ecosystem: link.ecosystem,
                manifestFile: link.manifest_file,
            });
        }
    }

    return [...repositories.values()]
        .map(repo => {
            const vulnerabilities = [...repo.vulnerabilities.values()].sort(bySeverityThenScore);
            return {
                ...repo,
                vulnerabilities,
                worstSeverity: vulnerabilities[0]?.severity ?? null,
            };
        })
        .sort((a, b) => {
            const rank = (SEVERITY_RANK[b.worstSeverity] ?? 0) - (SEVERITY_RANK[a.worstSeverity] ?? 0);
            if (rank !== 0) return rank;
            return b.vulnerabilities.length - a.vulnerabilities.length;
        });
}

/**
 * Dependencies a registry has moved past, grouped by repository.
 *
 * A manifest declares a constraint, not a version, so whether it is behind is a
 * question for compareVersions() rather than for SQL.
 */
function groupDependenciesBehind(rows) {
    const repositories = new Map();
    let count = 0;

    for (const row of rows) {
        const comparison = compareVersions(row.ecosystem, row.version, row.latest_version);
        if (comparison.state !== 'behind') continue;

        count += 1;

        let repo = repositories.get(row.repository_id);
        if (!repo) {
            repo = {
                id: row.repository_id,
                name: row.repository_name,
                url: row.repository_url,
                dependencies: [],
            };
            repositories.set(row.repository_id, repo);
        }

        repo.dependencies.push({
            ecosystem: row.ecosystem,
            name: row.name,
            declared: row.version,
            latest: row.latest_version,
            gap: comparison.gap,
            manifestFile: row.manifest_file,
        });
    }

    return {
        count,
        repositories: [...repositories.values()].sort(
            (a, b) => b.dependencies.length - a.dependencies.length
        ),
    };
}

/**
 * @param {Array} vulnerabilities Everything stored
 * @param {object} [options]
 * @param {Array} [options.links] Rows from vulnerabilityRepositoryLinks()
 * @param {Array} [options.dependencies] Rows from dependenciesWithLatest()
 * @param {number[]} [options.repositoryIds] Scope to these repositories, for a
 *   per-owner digest. Omit for the whole fleet.
 * @param {number} [options.windowDays]
 * @param {Date|string} [options.now]
 * @returns {object|null} The report, or null when there is nothing to say
 */
export function generateWeeklyReport(vulnerabilities, options = {}) {
    const windowDays = options.windowDays ?? DEFAULT_WINDOW_DAYS;
    const now = options.now ? new Date(options.now) : new Date();
    const since = new Date(now.getTime() - windowDays * MS_PER_DAY);

    const scope = options.repositoryIds ? new Set(options.repositoryIds) : null;
    const links = (options.links ?? []).filter(
        link => !scope || scope.has(link.repository_id)
    );
    const dependencyRows = (options.dependencies ?? []).filter(
        row => !scope || scope.has(row.repository_id)
    );

    const open = vulnerabilities.filter(
        v => v.status === Status.OPEN || v.status === Status.ACKNOWLEDGED
    );

    // A row with no usable timestamp counts as new: it cannot be shown to be
    // older than the window, and leaving it out would hide it forever.
    const fresh = open.filter(vuln => {
        const seen = firstSeen(vuln);
        return seen === null || seen >= since;
    });

    const presented = new Map(fresh.map(vuln => [vuln.cve_id ?? vuln.cveId, present(vuln)]));

    // Which of this window's CVEs reach code, and which only reach the plumbing.
    const reachesCode = new Set();
    const reachesInfrastructure = new Set();

    for (const link of links) {
        if (!presented.has(link.cve_id)) continue;
        if (INFRASTRUCTURE_ECOSYSTEMS.has(link.ecosystem)) reachesInfrastructure.add(link.cve_id);
        else reachesCode.add(link.cve_id);
    }

    // The same split over the whole backlog, not just the window.
    //
    // Without it the digest says 9 where the console says 27, and both are
    // right: one counts what arrived this week, the other what is still open.
    // A report has to say which number it is showing, so it shows both.
    const openIds = new Set(open.map(vuln => vuln.cve_id ?? vuln.cveId));
    const openReachesCode = new Set();
    const openReachesInfrastructure = new Set();

    for (const link of links) {
        if (!openIds.has(link.cve_id)) continue;
        if (INFRASTRUCTURE_ECOSYSTEMS.has(link.ecosystem)) openReachesInfrastructure.add(link.cve_id);
        else openReachesCode.add(link.cve_id);
    }

    const openAffecting = openReachesCode.size;
    const openInfrastructure = [...openReachesInfrastructure].filter(id => !openReachesCode.has(id)).length;

    const affectingLinks = links.filter(link => reachesCode.has(link.cve_id));
    const affectingRepositories = groupByRepository(affectingLinks, presented);

    // A scoped digest is about the subscriber's repositories. The other two
    // sections are, by definition, everything that reaches none of them — which
    // for one owner is the whole world's noise, not their business.
    const otherSections = scope
        ? { infrastructure: capped([]), other: capped([]) }
        : {
              infrastructure: capped(
                  [...reachesInfrastructure].filter(id => !reachesCode.has(id)).map(id => presented.get(id))
              ),
              other: capped(
                  [...presented.entries()]
                      .filter(([cveId]) => !reachesCode.has(cveId) && !reachesInfrastructure.has(cveId))
                      .map(([, vuln]) => vuln)
              ),
          };

    const dependencies = groupDependenciesBehind(dependencyRows);

    // Nothing detected, nothing open and nothing behind: there is no report to
    // send. A scoped digest for a quiet repository lands here, which is the
    // point — its owner does not get a weekly email saying nothing happened.
    if (scope) {
        const nothingForThem = reachesCode.size === 0 && dependencies.count === 0;
        if (nothingForThem) return null;
    } else if (fresh.length === 0 && open.length === 0 && dependencies.count === 0) {
        return null;
    }

    return {
        generatedAt: now.toISOString(),
        windowDays,
        since: since.toISOString(),
        scoped: Boolean(scope),

        // What the body lists: this window's detections, split as the console
        // splits them.
        totalCount: fresh.length,
        affecting: {
            // New in the window, and the standing total the console shows.
            count: reachesCode.size,
            openCount: openAffecting,
            repositories: affectingRepositories,
        },
        infrastructure: { ...otherSections.infrastructure, openCount: openInfrastructure },
        other: otherSections.other,
        dependencies,

        // The running backlog, for context in the header.
        openTotal: open.length,
        openBySeverity: countBySeverity(open),
    };
}

export { SEVERITY_ORDER, SECTION_LIMIT };
