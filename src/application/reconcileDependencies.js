import logger from '../infrastructure/logger.js';

/**
 * Reconcile what a manifest declares against what a lockfile resolved.
 *
 * A dependency is unique on (repository_id, ecosystem, name, manifest_file), so
 * a repository holding both package.json and package-lock.json stores lodash
 * twice — once as `^4.17.0` and once as `4.17.21`. Every count doubles, the
 * Dependencies tab lists it twice with two different verdicts, and correlation
 * matches the CVE against both.
 *
 * Only the resolved version answers "are we vulnerable": `^4.17.0` cannot say
 * whether the installed copy is 4.17.11, which is, or 4.17.21, which is not.
 * So a lockfile row supersedes the manifest row for the same package.
 *
 * Scoped by directory, not repository-wide. A monorepo's apps/a and apps/b each
 * have their own lockfile and each legitimately depends on lodash — collapsing
 * those into one row would lose an application. A lockfile covers its own
 * directory and everything under it, which is also what makes a root lockfile
 * supersede the manifests of an npm or pnpm workspace.
 */

/** The directory a manifest sits in. Empty string for one at the repository root. */
function directoryOf(path) {
    const cut = path.lastIndexOf('/');
    return cut < 0 ? '' : path.slice(0, cut);
}

/** Does a lockfile in `lockDir` speak for a manifest at `manifestPath`? */
function covers(lockDir, manifestPath) {
    return lockDir === '' || manifestPath.startsWith(`${lockDir}/`);
}

/**
 * @param {import('../domain/entities/Dependency.js').default[]} deps
 * @param {Set<string>} resolvedFrom  Manifest paths whose parser states resolved versions
 * @returns {import('../domain/entities/Dependency.js').default[]}
 */
export function reconcileDependencies(deps, resolvedFrom) {
    if (!resolvedFrom?.size) return deps;

    const resolved = deps.filter(dep => resolvedFrom.has(dep.manifestFile));
    if (resolved.length === 0) return deps;

    // Which directories hold a lockfile naming this exact package.
    const lockDirs = new Map();
    for (const dep of resolved) {
        const key = `${dep.ecosystem} ${dep.name}`;
        if (!lockDirs.has(key)) lockDirs.set(key, new Set());
        lockDirs.get(key).add(directoryOf(dep.manifestFile));
    }

    const kept = deps.filter(dep => {
        if (resolvedFrom.has(dep.manifestFile)) return true;

        const dirs = lockDirs.get(`${dep.ecosystem} ${dep.name}`);
        // A lockfile that does not list the package does not speak for it. The
        // manifest row is then the only record there is, and dropping it would
        // lose a dependency rather than deduplicate one.
        if (!dirs) return true;

        return ![...dirs].some(dir => covers(dir, dep.manifestFile));
    });

    const superseded = deps.length - kept.length;
    if (superseded > 0) {
        logger.debug({ superseded, resolved: resolved.length }, 'Manifest rows superseded by a lockfile');
    }

    return kept;
}

/**
 * The manifest paths among `parseJobs` whose parser states resolved versions.
 *
 * A parser declares this about itself, by exporting `resolvesVersions`. The
 * scanner keeping its own list of lockfile names would be a second list, and a
 * second list is how the two drift.
 *
 * @param {{ filePath: string, parser: object }[]} parseJobs
 * @returns {Set<string>}
 */
export function resolvedManifests(parseJobs) {
    return new Set(
        parseJobs.filter(job => job.parser.resolvesVersions === true).map(job => job.filePath)
    );
}
