import express from 'express';
import monitorVulns from '../../application/monitorVulns.js';
import logger from '../../infrastructure/logger.js';

/**
 * A monitoring cycle takes tens of seconds and hits every feed, so it runs
 * detached from the request and only one may be in flight at a time — two
 * concurrent cycles would double every outbound request for no benefit.
 */
let currentRun = null;

function runState() {
    return {
        running: Boolean(currentRun),
        startedAt: currentRun?.startedAt ?? null,
        lastRun: runState.last ?? null,
    };
}
runState.last = null;

export function createScanRoutes() {
    const router = express.Router();

    // GET /scan — status of the monitoring cycle
    router.get('/', (_req, res) => {
        res.json(runState());
    });

    // POST /scan — trigger a cycle
    router.post('/', (_req, res) => {
        if (currentRun) {
            return res.status(409).json({ error: 'A monitoring cycle is already running', ...runState() });
        }

        const startedAt = new Date().toISOString();
        currentRun = { startedAt };

        // Deliberately not awaited: the response returns immediately with 202.
        monitorVulns()
            .then(() => {
                runState.last = { startedAt, finishedAt: new Date().toISOString(), ok: true, error: null };
            })
            .catch(error => {
                logger.error({ err: error }, 'Triggered monitoring cycle failed');
                runState.last = {
                    startedAt,
                    finishedAt: new Date().toISOString(),
                    ok: false,
                    error: error.message,
                };
            })
            .finally(() => {
                currentRun = null;
            });

        logger.info('Monitoring cycle triggered via API');
        res.status(202).json({ accepted: true, startedAt });
    });

    return router;
}
