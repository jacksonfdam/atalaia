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
 * One request per dependency to somebody else's registry, so this is a queued
 * job rather than something a request waits for. Each row is written the moment
 * its own answer arrives, so a run that dies halfway leaves everything it had
 * already resolved and the console can render partial results.
 *
 * "One check per repository at a time" and "how did the last one end" are the
 * queue's business now (deps.versions is an exclusive queue keyed by repository)
 * rather than a Map in this module, which a restart erased and a second
 * container could not see.
 *
 * A few at a time — enough to not take a minute over three hundred packages,
 * few enough to stay a polite client of registries that are free to use.
 */

const CONCURRENCY = parseInt(process.env.REGISTRY_CONCURRENCY, 10) || 6;

/**
 * @param {number} repositoryId
 * @param {object} [options]
 * @param {boolean} [options.force]        Re-check even recently checked rows
 * @param {number} [options.maxAgeHours]   How old an answer may be before it is re-asked
 * @param {(progress: object) => void|Promise<void>} [options.onProgress]
 * @returns {Promise<{ total: number, done: number, outdated: number, failed: number }>}
 */
export async function checkDependencyVersions(repositoryId, options = {}) {
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

    const progress = { total: pending.length, done: 0, outdated: 0, failed: 0, current: null };
    const report = options.onProgress ?? (() => {});

    await report({ ...progress });

    for (let start = 0; start < pending.length; start += CONCURRENCY) {
        const batch = pending.slice(start, start + CONCURRENCY);
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

        await report({ ...progress });
    }

    progress.current = null;
    logger.info({ repoId: repositoryId, ...progress }, 'Version check complete');

    return { ...progress };
}

export default checkDependencyVersions;
