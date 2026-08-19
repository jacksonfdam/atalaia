import { compareVersions } from './versionComparison.js';
import { toDate } from '../infrastructure/db/pool.js';
import {
    dependencyInventory,
    repositoryInventory,
} from '../infrastructure/cache/repositoryStore.js';

/**
 * What the fleet is built with, and how far behind it is.
 *
 * The weekly digest answers "what was published this week that reaches us". This
 * answers the question asked the other way round, the one that comes up in a
 * planning meeting rather than an incident: what do we depend on, how much of it
 * has moved on without us, and which languages and ecosystems is that spread
 * across.
 *
 * The whole report turns on one distinction. A dependency nobody has compared
 * with a registry is **not** up to date — it is unknown. Four states, never
 * three:
 *
 *   current    the manifest already allows the newest published release
 *   behind     the registry has something the manifest does not admit
 *   unknown    asked, and the answer cannot be compared (a digest, a commit,
 *              an interval) or the registry refused
 *   unchecked  never asked
 *
 * Folding `unchecked` into `current` would make every percentage on the page a
 * claim nobody verified, which is the one thing this codebase does not do.
 */

/** Lists are capped and say so; the count beside them is the whole truth. */
const LIST_LIMIT = 25;

/** A scan older than this is worth mentioning: the manifests may have moved. */
const STALE_SCAN_DAYS = 30;

/** Registry answers older than this are worth mentioning for the same reason. */
const STALE_CHECK_DAYS = 7;

const MS_PER_DAY = 86_400_000;

const GAP_RANK = { major: 3, minor: 2, patch: 1 };

function ageInDays(value, now) {
    const date = toDate(value);
    return date ? Math.floor((now.getTime() - date.getTime()) / MS_PER_DAY) : null;
}

function iso(value) {
    return toDate(value)?.toISOString() ?? null;
}

/** Case-insensitive, because `Lodash` and `lodash` are one package. */
function packageKey(row) {
    return `${row.ecosystem} ${String(row.name).toLowerCase()}`;
}

/**
 * Where one dependency stands.
 *
 * @param {object} row A repository_dependencies row
 * @returns {{ state: 'current'|'behind'|'unknown'|'unchecked', gap: string|null, reason: string|null }}
 */
export function dependencyState(row) {
    if (!row.latest_checked_at) {
        return { state: 'unchecked', gap: null, reason: 'No registry lookup has run for this one' };
    }

    // The lookup ran and the registry had nothing usable to say. Keeping the
    // error is what lets the console explain a gap instead of showing a dash.
    if (row.latest_error) return { state: 'unknown', gap: null, reason: row.latest_error };

    return compareVersions(row.ecosystem, row.version, row.latest_version);
}

/** Sort the most actionable first: the most repositories, then the widest gap. */
function byReachThenGap(a, b) {
    if (b.repositories !== a.repositories) return b.repositories - a.repositories;
    const gap = (GAP_RANK[b.worstGap] ?? 0) - (GAP_RANK[a.worstGap] ?? 0);
    if (gap !== 0) return gap;
    return a.name.localeCompare(b.name);
}

function capped(items, limit) {
    return { count: items.length, shown: Math.min(items.length, limit), items: items.slice(0, limit) };
}

/**
 * The report, from rows.
 *
 * Pure on purpose: no database, no clock of its own, so every count below is
 * testable against a handful of literal rows. The fetching half is
 * buildDependencyReport() at the bottom of this file.
 *
 * @param {{ repositories: object[], dependencies: object[] }} rows
 * @param {{ now?: Date|string, limit?: number, scope?: 'fleet'|'repository' }} [options]
 */
export function generateDependencyReport({ repositories = [], dependencies = [] }, options = {}) {
    const now = toDate(options.now) ?? new Date();
    const limit = options.limit ?? LIST_LIMIT;

    const byState = { current: 0, behind: 0, unknown: 0, unchecked: 0 };
    const byGap = { major: 0, minor: 0, patch: 0, other: 0 };

    const packages = new Set();
    const manifests = new Set();
    const manifestKinds = new Map();
    const ecosystems = new Map();
    const behindPackages = new Map();
    const perRepository = new Map();

    let newestCheck = null;
    let oldestCheck = null;

    for (const repo of repositories) {
        perRepository.set(repo.id, {
            id: repo.id,
            name: repo.name,
            url: repo.url,
            lastScannedAt: iso(repo.last_scanned_at),
            total: 0,
            behind: 0,
            unchecked: 0,
        });
    }

    for (const row of dependencies) {
        const { state, gap } = dependencyState(row);
        byState[state] += 1;

        packages.add(packageKey(row));

        if (row.manifest_file) {
            manifests.add(`${row.repository_id} ${row.manifest_file}`);

            // The file's own name, not its path: twelve package.json files in a
            // monorepo are one answer to "what is this built with".
            const kind = String(row.manifest_file).split('/').pop();
            const kindEntry = manifestKinds.get(kind) ?? {
                file: kind,
                packages: 0,
                repositories: new Set(),
            };
            kindEntry.packages += 1;
            kindEntry.repositories.add(row.repository_id);
            manifestKinds.set(kind, kindEntry);
        }

        const ecosystem = ecosystems.get(row.ecosystem) ?? {
            name: row.ecosystem,
            packages: 0,
            behind: 0,
            unchecked: 0,
            repositories: new Set(),
        };
        ecosystem.packages += 1;
        if (state === 'behind') ecosystem.behind += 1;
        if (state === 'unchecked') ecosystem.unchecked += 1;
        ecosystem.repositories.add(row.repository_id);
        ecosystems.set(row.ecosystem, ecosystem);

        // A repository can hold dependencies while sitting outside the covered
        // set — disabled, on a fleet report. Counted where it is, not dropped.
        const repo = perRepository.get(row.repository_id) ?? {
            id: row.repository_id,
            name: row.repository_name,
            url: row.repository_url,
            lastScannedAt: null,
            total: 0,
            behind: 0,
            unchecked: 0,
        };
        repo.total += 1;
        if (state === 'behind') repo.behind += 1;
        if (state === 'unchecked') repo.unchecked += 1;
        perRepository.set(row.repository_id, repo);

        const checked = toDate(row.latest_checked_at);
        if (checked) {
            if (!newestCheck || checked > newestCheck) newestCheck = checked;
            if (!oldestCheck || checked < oldestCheck) oldestCheck = checked;
        }

        if (state !== 'behind') continue;

        byGap[gap && gap in byGap ? gap : 'other'] += 1;

        // Grouped across repositories: one upgrade that clears nine of them is
        // a different piece of work from nine unrelated ones.
        const key = packageKey(row);
        const entry = behindPackages.get(key) ?? {
            ecosystem: row.ecosystem,
            name: row.name,
            latest: row.latest_version,
            worstGap: null,
            declared: new Set(),
            repositoryIds: new Set(),
        };
        // Always set on a row that came back `behind`: compareVersions answers
        // `unknown` when the manifest declares nothing to compare.
        entry.declared.add(row.version);
        entry.repositoryIds.add(row.repository_id);
        if ((GAP_RANK[gap] ?? 0) > (GAP_RANK[entry.worstGap] ?? 0)) entry.worstGap = gap;
        behindPackages.set(key, entry);
    }

    // Languages come from the provider and describe the code, ecosystems from
    // the manifests and describe what it depends on. A repository can report
    // TypeScript and carry its risk in a Dockerfile, so the two stay apart.
    const languageBytes = new Map();
    let describedRepositories = 0;

    for (const repo of repositories) {
        const languages = repo.languages ?? {};
        const names = Object.keys(languages);
        if (names.length > 0) describedRepositories += 1;

        for (const [name, bytes] of Object.entries(languages)) {
            const entry = languageBytes.get(name) ?? { name, bytes: 0, repositories: 0 };
            entry.bytes += Number(bytes) || 0;
            entry.repositories += 1;
            languageBytes.set(name, entry);
        }
    }

    const totalBytes = [...languageBytes.values()].reduce((total, entry) => total + entry.bytes, 0);
    const languages = [...languageBytes.values()]
        .sort((a, b) => b.bytes - a.bytes)
        .map(entry => ({
            ...entry,
            share: totalBytes > 0 ? Math.round((entry.bytes / totalBytes) * 1000) / 10 : null,
        }));

    const topicCounts = new Map();
    for (const repo of repositories) {
        for (const topic of repo.topics ?? []) {
            topicCounts.set(topic, (topicCounts.get(topic) ?? 0) + 1);
        }
    }

    const scanned = repositories.filter(repo => toDate(repo.last_scanned_at));
    const neverScanned = repositories.filter(repo => !toDate(repo.last_scanned_at));
    const staleScans = scanned.filter(
        repo => (ageInDays(repo.last_scanned_at, now) ?? 0) > STALE_SCAN_DAYS
    );
    const scanDates = scanned.map(repo => toDate(repo.last_scanned_at)).sort((a, b) => a - b);

    const notes = [];

    if (repositories.length === 0) {
        notes.push({
            level: 'warn',
            text: 'No repository is being tracked, so there is nothing to report on.',
        });
    }

    if (neverScanned.length > 0) {
        const names = neverScanned.slice(0, 5).map(repo => repo.name).join(', ');
        notes.push({
            level: 'warn',
            text:
                `${neverScanned.length} of ${repositories.length} ${
                    repositories.length === 1 ? 'repository has' : 'repositories have'
                } never been scanned, so ${
                    neverScanned.length === 1 ? 'it is' : 'they are'
                } absent from every count below rather than clean: ` +
                `${names}${neverScanned.length > 5 ? ` and ${neverScanned.length - 5} more` : ''}.`,
        });
    }

    if (byState.unchecked > 0) {
        notes.push({
            level: 'warn',
            text: `${byState.unchecked} of ${dependencies.length} dependencies have never been compared with a registry. They are unknown, not up to date — run a version check.`,
        });
    }

    if (byState.unknown > 0) {
        notes.push({
            level: 'info',
            text: `${byState.unknown} dependencies were checked and cannot be compared: a digest, a commit, an interval, or a registry that refused. Each one says why on the Dependencies tab.`,
        });
    }

    const newestCheckAge = ageInDays(newestCheck, now);
    if (newestCheckAge !== null && newestCheckAge > STALE_CHECK_DAYS) {
        notes.push({
            level: 'info',
            text: `The most recent registry answer is ${newestCheckAge} days old, so "behind" below is as of then.`,
        });
    }

    if (staleScans.length > 0) {
        notes.push({
            level: 'info',
            text: `${staleScans.length} ${
                staleScans.length === 1 ? 'repository was' : 'repositories were'
            } last scanned over ${STALE_SCAN_DAYS} days ago; their manifests may have changed since.`,
        });
    }

    if (repositories.length > 0 && describedRepositories === 0) {
        notes.push({
            level: 'info',
            text: 'No language breakdown has been read from the provider yet, so the languages below are empty rather than absent.',
        });
    }

    const behindList = [...behindPackages.values()]
        .map(entry => ({
            ecosystem: entry.ecosystem,
            name: entry.name,
            latest: entry.latest,
            worstGap: entry.worstGap,
            declared: [...entry.declared].slice(0, 3),
            repositories: entry.repositoryIds.size,
        }))
        .sort(byReachThenGap);

    const repositoryList = [...perRepository.values()].sort(
        (a, b) => b.behind - a.behind || b.total - a.total || a.name.localeCompare(b.name)
    );

    return {
        generatedAt: now.toISOString(),
        scope: {
            kind: options.scope === 'repository' ? 'repository' : 'fleet',
            repository:
                options.scope === 'repository' && repositories[0]
                    ? {
                        id: repositories[0].id,
                        name: repositories[0].name,
                        url: repositories[0].url,
                    }
                    : null,
        },
        coverage: {
            repositories: repositories.length,
            scanned: scanned.length,
            neverScanned: neverScanned.length,
            staleScans: staleScans.length,
            staleAfterDays: STALE_SCAN_DAYS,
            oldestScanAt: scanDates[0]?.toISOString() ?? null,
            newestScanAt: scanDates.at(-1)?.toISOString() ?? null,
        },
        dependencies: {
            total: dependencies.length,
            packages: packages.size,
            manifests: manifests.size,
            ecosystems: ecosystems.size,
            byState,
            checkedAt: {
                oldest: oldestCheck?.toISOString() ?? null,
                newest: newestCheck?.toISOString() ?? null,
            },
        },
        updates: {
            behind: byState.behind,
            byGap,
            packages: capped(behindList, limit),
            repositories: capped(repositoryList.filter(repo => repo.behind > 0), limit),
        },
        technologies: {
            languages,
            totalBytes,
            ecosystems: [...ecosystems.values()]
                .map(entry => ({ ...entry, repositories: entry.repositories.size }))
                .sort((a, b) => b.packages - a.packages),
            topics: [...topicCounts.entries()]
                .map(([name, count]) => ({ name, repositories: count }))
                .sort((a, b) => b.repositories - a.repositories || a.name.localeCompare(b.name)),
            manifests: [...manifestKinds.values()]
                .map(entry => ({ ...entry, repositories: entry.repositories.size }))
                .sort((a, b) => b.packages - a.packages),
        },
        repositories: capped(repositoryList, limit),
        notes,
    };
}

/**
 * The same report, with the rows fetched.
 *
 * Split the way buildReport() and generateWeeklyReport() are split, and for the
 * same reason: the route, an agent and a test must not each assemble it slightly
 * differently and then disagree.
 *
 * @param {{ repositoryId?: number|string|null, now?: Date|string, limit?: number }} [options]
 * @returns {Promise<object|null>} null when a named repository does not exist
 */
export async function buildDependencyReport({ repositoryId = null, now, limit } = {}) {
    const id = repositoryId === null || repositoryId === undefined ? null : Number(repositoryId);
    if (id !== null && !Number.isInteger(id)) throw new Error('repositoryId must be an integer');

    const [repositories, dependencies] = await Promise.all([
        repositoryInventory({ repositoryId: id }),
        dependencyInventory({ repositoryId: id }),
    ]);

    if (id !== null && repositories.length === 0) return null;

    return generateDependencyReport(
        { repositories, dependencies },
        { now, limit, scope: id === null ? 'fleet' : 'repository' }
    );
}

export default buildDependencyReport;
