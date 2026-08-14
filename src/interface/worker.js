import dotenv from 'dotenv';
import logger from '../infrastructure/logger.js';
import { initializeDatabase } from '../infrastructure/cache/postgresCache.js';
import { registerWorkers, registerSchedules } from '../infrastructure/queue/workers.js';
import { pruneProgress, stopBoss } from '../infrastructure/queue/boss.js';
import { closePool } from '../infrastructure/db/pool.js';

/**
 * The worker process.
 *
 * Opens no port and serves nothing: it takes jobs off the queue and runs them.
 * The API used to do this in the same process, which meant a feed cycle competed
 * with the requests the console was making, and killing the API mid-scan lost
 * the scan. They are separate containers now.
 */

// quiet: dotenv v17 otherwise prints a banner that breaks the structured log stream
dotenv.config({ quiet: true });

await initializeDatabase();
await pruneProgress();
await registerWorkers();
await registerSchedules();

logger.info('Atalaia worker running');

/**
 * Finish the job in hand before exiting. `docker stop` gives ten seconds by
 * default, which is enough for one repository but not for a fleet sweep — the
 * queue makes an interrupted sweep retryable rather than lost, so this drains
 * what it can and lets the rest be picked up again.
 */
async function shutdown(signal) {
    logger.info({ signal }, 'Worker shutting down');

    try {
        await stopBoss();
        await closePool();
    } catch (err) {
        logger.error({ err }, 'Shutdown failed');
    }

    process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
