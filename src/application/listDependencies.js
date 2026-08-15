import { getDependenciesByRepo } from '../infrastructure/cache/repositoryStore.js';
import { compareVersions } from './versionComparison.js';

/**
 * Every dependency of one repository, with whatever freshness has been resolved.
 *
 * Freshness is computed rather than stored: it compares two columns the scan
 * already writes, and a third column would be one more thing to keep in sync.
 * The console reads this through the REST API and an agent reads it through
 * MCP, so the shape is defined once here instead of in each interface.
 *
 * @param {number} repositoryId
 * @param {{ ecosystem?: string, outdatedOnly?: boolean }} [options]
 * @returns {Promise<{ count: number, outdated: number, unchecked: number,
 *                     groups: object[], dependencies: object[] }>}
 */
export async function listRepositoryDependencies(repositoryId, options = {}) {
    let dependencies = await getDependenciesByRepo(repositoryId);

    if (options.ecosystem) {
        const wanted = String(options.ecosystem).toUpperCase();
        dependencies = dependencies.filter(d => String(d.ecosystem).toUpperCase() === wanted);
    }

    let enriched = dependencies.map(dependency => {
        const comparison = compareVersions(
            dependency.ecosystem,
            dependency.version,
            dependency.latest_version
        );

        return {
            ...dependency,
            versionState: comparison.state,
            versionGap: comparison.gap,
            versionNote: comparison.reason,
            outdated: comparison.state === 'behind',
        };
    });

    // Grouped by ecosystem: a repository can carry Gradle, GitHub Actions,
    // Fastlane gems and npm at once, and they are read one type at a time.
    const groups = new Map();
    for (const dependency of enriched) {
        const group = groups.get(dependency.ecosystem) ?? {
            ecosystem: dependency.ecosystem,
            count: 0,
            outdated: 0,
            unchecked: 0,
        };

        group.count += 1;
        if (dependency.outdated) group.outdated += 1;
        if (!dependency.latest_checked_at) group.unchecked += 1;
        groups.set(dependency.ecosystem, group);
    }

    const summary = {
        count: enriched.length,
        outdated: enriched.filter(dependency => dependency.outdated).length,
        unchecked: enriched.filter(dependency => !dependency.latest_checked_at).length,
        groups: [...groups.values()].sort((a, b) => b.count - a.count),
    };

    // Applied after the counts: "12 of 340 are behind" is the sentence worth
    // reading, and it disappears if the totals are computed on the filtered set.
    if (options.outdatedOnly) enriched = enriched.filter(dependency => dependency.outdated);

    return { ...summary, dependencies: enriched };
}
