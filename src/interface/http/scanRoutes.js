import express from 'express';
import { enqueue, queueState } from '../../infrastructure/queue/boss.js';
import { QUEUES } from '../../infrastructure/queue/jobs.js';

/**
 * The monitoring cycle, as a job.
 *
 * The contract the console polls is unchanged — 202 to start, 409 while one is
 * running, GET for progress — but "is one running" is now a row in the queue
 * rather than a variable in this process. A restart no longer forgets, and a
 * second API container cannot start a parallel cycle.
 */
export function createScanRoutes() {
    const router = express.Router();

    // GET /scan — status of the monitoring cycle
    router.get('/', async (_req, res) => {
        res.json(await queueState(QUEUES.MONITOR_CYCLE));
    });

    // POST /scan — trigger a cycle
    router.post('/', async (_req, res) => {
        const { accepted, jobId } = await enqueue(QUEUES.MONITOR_CYCLE);

        if (!accepted) {
            return res.status(409).json({
                error: 'A monitoring cycle is already running',
                ...(await queueState(QUEUES.MONITOR_CYCLE)),
            });
        }

        res.status(202).json({ accepted: true, jobId });
    });

    return router;
}
