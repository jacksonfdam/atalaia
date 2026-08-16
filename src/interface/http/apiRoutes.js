import express from 'express';
import { requireApiKey } from '../../middleware/auth.js';
import { queryByTech } from '../../application/queryByTech.js';
import { createVulnerabilityRoutes } from './vulnerabilityRoutes.js';
import { createTechnologyRoutes } from './technologyRoutes.js';
import { createFeedRoutes } from './feedRoutes.js';
import { createRepositoryRoutes } from './repositoryRoutes.js';
import { createOrganizationRoutes } from './organizationRoutes.js';
import { createOwnerRoutes } from './ownerRoutes.js';
import { createSettingsRoutes } from './settingsRoutes.js';
import { createScanRoutes } from './scanRoutes.js';
import { createReportRoutes } from './reportRoutes.js';
import { currentCallbackUrl } from '../../infrastructure/callbackUrls.js';
import { describeTunnels } from '../../infrastructure/tunnels/tunnelRegistry.js';
import logger from '../../infrastructure/logger.js';

/**
 * Compose the REST API v1.
 *
 * Every route requires an API key. Resource routers live in sibling files;
 * this module only wires them together and keeps the two legacy top-level
 * endpoints (/stats, /query) at their published paths.
 *
 * @param {object} cache postgresCache module
 * @returns {express.Router}
 */
export function createApiRoutes(cache) {
    const router = express.Router();

    router.use(requireApiKey);

    router.use('/vulnerabilities', createVulnerabilityRoutes(cache));
    router.use('/technologies', createTechnologyRoutes());
    router.use('/feeds', createFeedRoutes());
    router.use('/organizations', createOrganizationRoutes());
    router.use('/repositories', createRepositoryRoutes());
    router.use('/owners', createOwnerRoutes());
    router.use('/settings', createSettingsRoutes(cache));
    router.use('/scan', createScanRoutes());
    router.use('/reports', createReportRoutes(cache));

    // GET /stats
    router.get('/stats', async (_req, res) => {
        res.json(await cache.stats());
    });

    // GET /callbacks — the address Slack and Telegram were given.
    //
    // Only this process knows it: on a tunnel the hostname is handed out at
    // boot and is different every restart, so the launcher, the console and
    // whoever is holding a bot token all have to ask rather than guess.
    router.get('/callbacks', (_req, res) => {
        res.json({ ...currentCallbackUrl(), providers: describeTunnels() });
    });

    // POST /query — query vulns by technology
    router.post('/query', async (req, res) => {
        const { technologies } = req.body ?? {};

        if (!Array.isArray(technologies)) {
            return res.status(400).json({ error: 'technologies must be an array' });
        }
        if (technologies.length === 0) {
            return res.status(400).json({ error: 'At least one technology required' });
        }

        logger.info({ techs: technologies }, 'Vulnerability query');
        const results = await queryByTech(technologies, cache);
        res.json({ count: results.length, vulnerabilities: results });
    });

    return router;
}
