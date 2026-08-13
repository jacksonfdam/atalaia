import express from 'express';
import { checkFeedHealth } from '../../application/checkFeedHealth.js';
import { FEEDS } from '../../infrastructure/feeds/feedRegistry.js';
import logger from '../../infrastructure/logger.js';

export function createFeedRoutes() {
    const router = express.Router();

    // GET /feeds — the registry, without touching the network
    router.get('/', (_req, res) => {
        res.json({
            feeds: FEEDS.map(({ name, label, enabled, disabledReason }) => ({
                name,
                label,
                enabled,
                disabledReason: disabledReason ?? null,
            })),
        });
    });

    // GET /feeds/health — live probe of every source
    router.get('/health', async (req, res) => {
        try {
            const result = await checkFeedHealth({ force: req.query.force === 'true' });
            res.json(result);
        } catch (error) {
            logger.error({ err: error }, 'Feed health check failed');
            res.status(500).json({ error: 'Feed health check failed' });
        }
    });

    return router;
}
