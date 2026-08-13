import {
    queryRepositories,
    repositoryFacets,
    REPOSITORY_LIMIT_DEFAULT,
    REPOSITORY_LIMIT_MAX,
} from '../infrastructure/cache/repositoryStore.js';
import { summarizeFleetRisk, worstSeverity } from './repositoryRisk.js';

/**
 * The repository list the console renders: filtered, sorted, paginated, with
 * each row's exposure attached.
 *
 * Filtering and column sorting happen in SQL; exposure is computed from the
 * vulnerability table, so filtering or sorting *by exposure* happens here, on
 * the already-filtered set. That set is one row per repository — small enough
 * that the alternative (a stored, stale join) would cost more than it saves.
 */

const SEVERITY_RANK = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1, UNKNOWN: 0 };

const EMPTY_RISK = { total: 0, bySeverity: {}, exploited: false, worst: null };

function clampLimit(raw) {
    const parsed = parseInt(raw, 10);
    if (!Number.isFinite(parsed)) return REPOSITORY_LIMIT_DEFAULT;
    return Math.min(Math.max(parsed, 1), REPOSITORY_LIMIT_MAX);
}

/** Worst severity first, then how many — the order you triage in. */
function byExposure(a, b) {
    const rankA = SEVERITY_RANK[a.risk.worst] ?? -1;
    const rankB = SEVERITY_RANK[b.risk.worst] ?? -1;
    if (rankA !== rankB) return rankB - rankA;
    if (a.risk.total !== b.risk.total) return b.risk.total - a.risk.total;
    return a.name.localeCompare(b.name);
}

/**
 * @param {object} [query] Raw query-string values
 * @returns {{ count: number, total: number, limit: number, offset: number,
 *             atRisk: number, facets: object, repositories: object[] }}
 */
export function listRepositoriesPage(query = {}) {
    const rows = queryRepositories({
        search: query.search,
        org: query.org,
        language: query.language,
        enabled: query.enabled === undefined ? undefined : query.enabled === 'true' || query.enabled === true,
        archived: query.archived === undefined ? undefined : query.archived === 'true' || query.archived === true,
        includeDeleted: query.includeDeleted === 'true' || query.includeDeleted === true,
        sort: query.sort,
        order: query.order,
    });

    const risk = summarizeFleetRisk();

    let repositories = rows.map(row => ({
        ...row,
        risk: risk.get(row.id) ?? EMPTY_RISK,
    }));

    // `exposure` is a filter as much as a sort: "show me only what is affected"
    // is the first thing anyone asks of this list.
    if (query.exposure === 'affected') {
        repositories = repositories.filter(repository => repository.risk.total > 0);
    } else if (query.exposure === 'clean') {
        repositories = repositories.filter(repository => repository.risk.total === 0);
    } else if (query.exposure === 'exploited') {
        repositories = repositories.filter(repository => repository.risk.exploited);
    }

    if (query.sort === 'exposure') {
        repositories.sort(byExposure);
        if (String(query.order).toLowerCase() === 'asc') repositories.reverse();
    }

    const total = repositories.length;
    const limit = clampLimit(query.limit);
    const offset = Math.max(parseInt(query.offset, 10) || 0, 0);
    const page = repositories.slice(offset, offset + limit);

    return {
        count: page.length,
        total,
        limit,
        offset,
        // Across everything tracked, not just this page — it is a fleet-wide
        // number and would be meaningless scoped to twenty-five rows.
        atRisk: [...risk.values()].filter(entry => entry.total > 0).length,
        facets: repositoryFacets(),
        repositories: page,
    };
}

export { worstSeverity };
