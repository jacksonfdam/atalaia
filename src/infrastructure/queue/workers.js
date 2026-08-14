import logger from '../logger.js';
import { getBoss, writeProgress } from './boss.js';
import { QUEUES, SCHEDULES } from './jobs.js';
import { getSetting } from '../settings.js';
import monitorVulns from '../../application/monitorVulns.js';
import { scanAllRepositories } from '../../application/scanAllRepositories.js';
import { scanRepository } from '../../application/scanRepository.js';
import { checkDependencyVersions } from '../../application/checkDependencyVersions.js';
import { buildReport } from '../../application/buildReport.js';
import { sendWeeklyEmail } from '../notifiers/emailNotifier.js';
import { getAll } from '../cache/postgresCache.js';
import { sendSubscriberDigests } from '../../application/notifySubscribers.js';
import { getRepository } from '../cache/repositoryStore.js';
import { providerForOrg } from '../../application/manageOrganization.js';

/**
 * Who does the work.
 *
 * The handlers are thin on purpose: every one of them is a use case that already
 * existed and was previously called from a route or from node-cron. What changed
 * is who calls it, and that "in flight", "how far along" and "how did it end"
 * are now recorded in the database instead of in a variable that a restart wiped.
 */

/** Fold one event from the scan into the progress snapshot. */
function applyEvent(progress, event) {
    switch (event.type) {
        case 'organizations':
            progress.organizations.total = event.total;
            break;

        case 'organization-start':
            progress.organizations.current = event.org;
            break;

        case 'organization-done':
            progress.organizations.done += 1;
            progress.organizations.current = null;
            break;

        case 'repositories':
            // Discovered per organization, so the total grows as the scan walks
            // them rather than being known up front.
            progress.repositories.total += event.total;
            progress.repositories.concurrency = event.concurrency ?? 1;
            break;

        case 'repository-start':
            // With several in flight this is the most recent one to start, not
            // the only one running — hence inFlight, which is what stops the
            // tail of a sweep looking stuck: `done` stops moving while the last
            // few large repositories are still being read.
            progress.repositories.current = event.repository;
            progress.repositories.inFlight = (progress.repositories.inFlight ?? 0) + 1;
            break;

        case 'repository-done':
            progress.repositories.done += 1;
            progress.repositories.inFlight = Math.max(0, (progress.repositories.inFlight ?? 1) - 1);
            progress.dependencies += event.dependencies ?? 0;
            break;

        case 'error':
            progress.errors.push(event.message);
            break;

        default:
            break;
    }
}

/**
 * How many repositories are scanned at once — the same knob the fleet sweep
 * reads, so raising it in one place does not leave the other serial.
 */
const SCAN_CONCURRENCY = Math.max(1, parseInt(process.env.SCAN_CONCURRENCY, 10) || 10);

/** pg-boss hands the handler an array; every queue here takes one job at a time. */
const one = handler => async ([job]) => handler(job);

export async function registerWorkers() {
    const boss = await getBoss();

    await boss.work(
        QUEUES.MONITOR_CYCLE,
        { batchSize: 1 },
        one(async job => {
            logger.info({ jobId: job.id }, 'Monitoring cycle started');
            await monitorVulns();
        })
    );

    // The fleet sweep stays one job rather than fanning out a job per
    // repository, because it is not only a scan: it walks each organization,
    // imports repositories that appeared, and soft-deletes the ones that are
    // gone from the provider. Splitting the scanning out would leave the
    // discovery with nowhere to live. It reports progress row by row, so what a
    // fan-out was for — seeing where it is — still works.
    await boss.work(
        QUEUES.REPO_SCAN_ALL,
        { batchSize: 1 },
        one(async job => {
            const progress = {
                organizations: { total: 0, done: 0, current: null },
                repositories: { total: 0, done: 0, current: null, inFlight: 0 },
                dependencies: 0,
                errors: [],
            };

            const result = await scanAllRepositories({
                skipVendorLookup: job.data?.skipVendorLookup ?? false,
                concurrency: job.data?.concurrency,
                onProgress: async event => {
                    applyEvent(progress, event);
                    await writeProgress(job.id, QUEUES.REPO_SCAN_ALL, progress);
                },
            });

            logger.info({ jobId: job.id, ...result }, 'Fleet scan complete');
            return result;
        })
    );

    // One-off scans, queued from the console or the CLI. They run as many at a
    // time as a fleet sweep does, from the same setting: the limit that matters
    // is somebody else's rate limit, and it does not care which queue the work
    // arrived on.
    await boss.work(
        QUEUES.REPO_SCAN,
        { batchSize: 1, teamSize: SCAN_CONCURRENCY, teamConcurrency: SCAN_CONCURRENCY },
        one(async job => {
            const { repositoryId, skipVendorLookup } = job.data;

            // The provider is built per job rather than passed in the payload:
            // a token is not something to write into a queue row.
            const repo = await getRepository(repositoryId);
            if (!repo) throw new Error(`Repository ${repositoryId} not found`);
            const provider = await providerForOrg(repo.org_key);

            const result = await scanRepository(repositoryId, provider, { skipVendorLookup });
            logger.info({ jobId: job.id, repositoryId, ...result }, 'Repository scanned');
            return result;
        })
    );

    await boss.work(
        QUEUES.DEPS_VERSIONS,
        { batchSize: 1 },
        one(async job => {
            const { repositoryId, force, maxAgeHours } = job.data;

            return checkDependencyVersions(repositoryId, {
                force,
                maxAgeHours,
                onProgress: progress => writeProgress(job.id, QUEUES.DEPS_VERSIONS, progress),
            });
        })
    );

    await boss.work(
        QUEUES.REPORT_WEEKLY,
        { batchSize: 1 },
        one(async job => {
            const cache = { getAll };
            const report = await buildReport(cache);
            await sendWeeklyEmail(report);

            // Then the people who asked about one repository in particular.
            const subscribers = await sendSubscriberDigests(cache);

            logger.info({ jobId: job.id, subscribers }, 'Weekly report sent');
        })
    );

    logger.info('Workers registered');
}

/**
 * Put the schedules in the database.
 *
 * pg-boss owns the cron, so two containers no longer fire the same cycle twice
 * and a schedule survives a restart. Changing one in the console takes effect
 * when the worker next registers — a restart, which is also when node-cron
 * needed one.
 */
export async function registerSchedules() {
    const boss = await getBoss();

    for (const schedule of SCHEDULES) {
        if (schedule.enabledSetting && !(await getSetting(schedule.enabledSetting))) {
            // Unschedule rather than skip: turning autoScan off in the console
            // has to actually stop the nightly sweep, including one registered
            // by an earlier boot.
            await boss.unschedule(schedule.queue).catch(() => {});
            logger.info({ queue: schedule.queue }, 'Schedule off');
            continue;
        }

        const cron = schedule.setting
            ? await getSetting(schedule.setting)
            : process.env[schedule.env] || schedule.fallback;

        await boss.schedule(schedule.queue, cron || schedule.fallback);
        logger.info({ queue: schedule.queue, cron: cron || schedule.fallback }, 'Scheduled');
    }
}
