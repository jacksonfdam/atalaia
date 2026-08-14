import express from 'express';
import { checkFeedHealth, resetFeedHealthCache } from '../../application/checkFeedHealth.js';
import { listFeeds, setFeedEnabled, resetFeed } from '../../infrastructure/feeds/feedRegistry.js';
import { listCatalog } from '../../infrastructure/feeds/databaseCatalog.js';
import logger from '../../infrastructure/logger.js';

/** The shape the console renders; the fetch function itself never leaves here. */
function present(feed) {
    return {
        name: feed.name,
        label: feed.label,
        enabled: feed.enabled,
        defaultEnabled: feed.defaultEnabled,
        overridden: feed.overridden,
        disabledReason: feed.disabledReason ?? null,
        updatedAt: feed.updatedAt,
        updatedBy: feed.updatedBy,
        catalog: feed.catalog,
    };
}

export function createFeedRoutes() {
    const router = express.Router();

    // GET /feeds — the registry, without touching the network
    router.get('/', async (_req, res) => {
        res.json({ feeds: (await listFeeds()).map(present) });
    });

    // GET /feeds/catalog — every known public database, collected or not
    router.get('/catalog', (_req, res) => {
        const databases = listCatalog();
        res.json({
            count: databases.length,
            implemented: databases.filter(entry => entry.feed).length,
            databases,
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

    // PATCH /feeds/:name — turn a source on or off
    router.patch('/:name', async (req, res) => {
        const { enabled } = req.body ?? {};

        if (typeof enabled !== 'boolean') {
            return res.status(400).json({ error: 'enabled must be a boolean' });
        }

        try {
            const feed = await setFeedEnabled(req.params.name, enabled, req.get('X-Actor') || 'api');
            // The cached health report still describes the old state.
            resetFeedHealthCache();
            res.json(present(feed));
        } catch (error) {
            res.status(404).json({ error: error.message });
        }
    });

    // DELETE /feeds/:name/override — follow the registry default again
    router.delete('/:name/override', async (req, res) => {
        try {
            const feed = await resetFeed(req.params.name);
            resetFeedHealthCache();
            res.json(present(feed));
        } catch (error) {
            res.status(404).json({ error: error.message });
        }
    });

    return router;
}
