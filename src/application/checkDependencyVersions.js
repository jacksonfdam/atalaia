import logger from '../infrastructure/logger.js';
import { fetchLatestVersion, supportsEcosystem } from '../infrastructure/registries/index.js';
import { compareVersions } from './versionComparison.js';
import {
    getDependenciesByRepo,
    getRepository,
    setDependencyLatestVersion,
} from '../infrastructure/cache/repositoryStore.js';

/**
 * Look up the latest published version of every dependency in a repository.
 *
 * One request per dependency to somebody else's registry, so this never runs
 * inside a request: it is started, it reports progress, and each row is written
 * the moment its own answer arrives. The console renders what is already there
 * and fills in the rest as it lands.
 *
 * A few at a time — enough to not take a minute over three hundred packages,
 * few enough to stay a polite client of registries that are free to use.
 */

const CONCURRENCY = parseInt(process.env.REGISTRY_CONCURRENCY, 10) || 6;

/** One run per repository, keyed by id, so two tabs cannot double the traffic. */
const runs = new Map();
const lastRuns = new Map();

export function versionCheckState(repositoryId) {
    const current = runs.get(repositoryId);

    return {
        running: Boolean(current),
        startedAt: current?.startedAt ?? null,
        progress: current ? { ...current.progress } : null,
        lastRun: lastRuns.get(repositoryId) ?? null,
    };
}

/**
 * @param {number} repositoryId
 * @param {{ force?: boolean, maxAgeHours?: number }} [options]
 *   By default a dependency checked recently is left alone; `force` re-checks
 *   everything.
 */
export async function startVersionCheck(repositoryId, options = {}) {
    if (runs.has(repositoryId)) {
        return { accepted: false, state: versionCheckState(repositoryId) };
    }

    const repo = await getRepository(repositoryId);
    if (!repo) throw new Error(`Repository ${repositoryId} not found`);

    const dependencies = await getDependenciesByRepo(repositoryId);
    const maxAgeMs = (options.maxAgeHours ?? 24) * 3_600_000;

    const pending = dependencies.filter(dependency => {
        if (!supportsEcosystem(dependency.ecosystem)) return false;
        if (options.force) return true;
        if (!dependency.latest_checked_at) return true;

        const checkedAt = Date.parse(String(dependency.latest_checked_at).replace(' ', 'T') + 'Z');
        return Number.isNaN(checkedAt) || Date.now() - checkedAt > maxAgeMs;
    });

    const startedAt = new Date().toISOString();
    const progress = { total: pending.length, done: 0, outdated: 0, failed: 0, current: null };
    runs.set(repositoryId, { startedAt, progress });

    // Not awaited: the caller gets an answer now and polls for the rest.
    await run(repositoryId, pending, progress)
        .then(() => {
            lastRuns.set(repositoryId, {
                startedAt,
                finishedAt: new Date().toISOString(),
                ok: true,
                checked: progress.done,
                failed: progress.failed,
            });
        })
        .catch(error => {
            logger.error({ repoId: repositoryId, err: error }, 'Version check failed');
            lastRuns.set(repositoryId, {
                startedAt,
                finishedAt: new Date().toISOString(),
                ok: false,
                checked: progress.done,
                failed: progress.failed,
                error: error.message,
            });
        })
        .finally(() => {
            runs.delete(repositoryId);
        });

    logger.info({ repoId: repositoryId, pending: pending.length }, 'Version check started');
    return { accepted: true, startedAt, pending: pending.length };
}

async function run(repositoryId, dependencies, progress) {
    for (let start = 0; start < dependencies.length; start += CONCURRENCY) {
        const batch = dependencies.slice(start, start + CONCURRENCY);
        progress.current = batch[0]?.name ?? null;

        await Promise.all(
            batch.map(async dependency => {
                const { latest, error } = await fetchLatestVersion(dependency.ecosystem, dependency.name);

                // Written here, one row at a time, rather than in a batch at the
                // end: partial results are useful, a lost batch is not.
                await setDependencyLatestVersion(dependency.id, { latest, error });

                progress.done += 1;
                if (error) progress.failed += 1;
                else if (compareVersions(dependency.ecosystem, dependency.version, latest).state === 'behind') {
                    progress.outdated += 1;
                }
            })
        );
    }

    progress.current = null;
    logger.info({ repoId: repositoryId, ...progress }, 'Version check complete');
}
