import logger from '../logger.js';
import { getBoss, writeProgress } from './boss.js';
import { QUEUES, SCHEDULES } from './jobs.js';
import { getSetting } from '../settings.js';
import monitorVulns from '../../application/monitorVulns.js';
import { scanAllRepositories } from '../../application/scanAllRepositories.js';
import { scanRepository } from '../../application/scanRepository.js';
import { checkDependencyVersions } from '../../application/checkDependencyVersions.js';
import { generateWeeklyReport } from '../../application/generateWeeklyReport.js';
import { sendWeeklyEmail } from '../notifiers/emailNotifier.js';
import { getAll } from '../cache/postgresCache.js';
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
            break;

        case 'repository-start':
            progress.repositories.current = event.repository;
            break;

        case 'repository-done':
            progress.repositories.done += 1;
            progress.repositories.current = null;
            progress.dependencies += event.dependencies ?? 0;
            break;

        case 'error':
            progress.errors.push(event.message);
            break;

        default:
            break;
    }
}

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
                repositories: { total: 0, done: 0, current: null },
                dependencies: 0,
                errors: [],
            };

            const result = await scanAllRepositories({
                skipVendorLookup: job.data?.skipVendorLookup ?? false,
                onProgress: async event => {
                    applyEvent(progress, event);
                    await writeProgress(job.id, QUEUES.REPO_SCAN_ALL, progress);
                },
            });

            logger.info({ jobId: job.id, ...result }, 'Fleet scan complete');
            return result;
        })
    );

    // teamSize 1: deliberately one repository at a time, which is what kept the
    // GitHub rate limit and the log readable when this was a sequential loop.
    // The difference is that the queue now remembers where it got to.
    await boss.work(
        QUEUES.REPO_SCAN,
        { batchSize: 1, teamSize: 1, teamConcurrency: 1 },
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
            const report = generateWeeklyReport(await getAll());
            await sendWeeklyEmail(report);
            logger.info({ jobId: job.id }, 'Weekly report sent');
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
