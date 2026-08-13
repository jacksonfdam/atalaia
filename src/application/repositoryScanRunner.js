import logger from '../infrastructure/logger.js';
import { scanAllRepositories } from './scanAllRepositories.js';

/**
 * The fleet scan, detached from the request that asked for it.
 *
 * A single repository takes ten seconds or so, so a hundred of them outlives
 * any HTTP timeout — the console's proxy gives up after two minutes and the
 * caller is left guessing while the scan keeps running. The work therefore runs
 * in the background and reports progress here, the same shape the monitoring
 * cycle already uses.
 *
 * Deliberately sequential: the scan is not the slow part of anyone's day, and
 * one repository at a time keeps the GitHub rate limit and the log readable.
 */

let current = null;
let last = null;

function emptyProgress() {
    return {
        organizations: { total: 0, done: 0, current: null },
        repositories: { total: 0, done: 0, current: null },
        dependencies: 0,
        errors: [],
    };
}

/** What the console polls. */
export function fleetScanState() {
    return {
        running: Boolean(current),
        startedAt: current?.startedAt ?? null,
        progress: current?.progress ?? null,
        lastRun: last,
    };
}

/**
 * Start a scan unless one is already in flight.
 *
 * @param {{ skipVendorLookup?: boolean }} [options]
 * @returns {{ accepted: boolean, startedAt?: string, state?: object }}
 */
export function startFleetScan(options = {}) {
    if (current) {
        return { accepted: false, state: fleetScanState() };
    }

    const startedAt = new Date().toISOString();
    const progress = emptyProgress();
    current = { startedAt, progress };

    // Not awaited: the caller gets an immediate answer and polls for the rest.
    scanAllRepositories({ ...options, onProgress: event => applyEvent(progress, event) })
        .then(result => {
            last = {
                startedAt,
                finishedAt: new Date().toISOString(),
                ok: true,
                repositories: result.totalRepos,
                dependencies: result.totalDeps,
                errors: result.errors,
            };
        })
        .catch(error => {
            logger.error({ err: error }, 'Fleet scan failed');
            last = {
                startedAt,
                finishedAt: new Date().toISOString(),
                ok: false,
                repositories: progress.repositories.done,
                dependencies: progress.dependencies,
                errors: [...progress.errors, error.message],
            };
        })
        .finally(() => {
            current = null;
        });

    logger.info(options, 'Fleet scan started');
    return { accepted: true, startedAt };
}

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

/** Exported for tests. */
export function resetFleetScanState() {
    current = null;
    last = null;
}
