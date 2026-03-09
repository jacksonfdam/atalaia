import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { requireApiKey } from '../../middleware/auth.js';
import { acknowledgeVuln } from '../../application/acknowledgeVuln.js';
import { resolveVuln } from '../../application/resolveVuln.js';
import { queryByTech } from '../../application/queryByTech.js';
import logger from '../../infrastructure/logger.js';

const TECH_CONFIG_PATH = path.resolve('config/technologies.json');

/**
 * Create REST API routes for vulnerability management.
 * @param {{ get: Function, getAll: Function, update: Function }} cache
 * @returns {express.Router}
 */
export function createApiRoutes(cache) {
    const router = express.Router();

    router.use(requireApiKey);

    // PATCH /api/v1/vulnerabilities/:cveId/status
    router.patch('/vulnerabilities/:cveId/status', async (req, res) => {
        const { cveId } = req.params;
        const { status, changedBy } = req.body;

        if (!status || !changedBy) {
            return res.status(400).json({ error: 'Missing required fields: status, changedBy' });
        }

        try {
            let vuln;
            if (status === 'ACKNOWLEDGED') {
                vuln = await acknowledgeVuln(cveId, changedBy, cache);
            } else if (status === 'RESOLVED') {
                vuln = await resolveVuln(cveId, changedBy, cache);
            } else {
                return res.status(400).json({ error: `Invalid status: ${status}. Must be ACKNOWLEDGED or RESOLVED` });
            }

            res.json(vuln);
        } catch (error) {
            logger.warn({ cveId, err: error }, 'Status update failed');
            const statusCode = error.message.includes('not found') ? 404 : 400;
            res.status(statusCode).json({ error: error.message });
        }
    });

    // GET /api/v1/vulnerabilities
    router.get('/vulnerabilities', (req, res) => {
        const { status, severity, source } = req.query;
        let vulns = cache.getAll();

        if (status) vulns = vulns.filter(v => v.status === status);
        if (severity) vulns = vulns.filter(v => v.severity === severity);
        if (source) vulns = vulns.filter(v => v.source === source);

        res.json({ count: vulns.length, vulnerabilities: vulns });
    });

    // GET /api/v1/technologies (public — no API key required)
    router.get('/technologies', async (req, res) => {
        try {
            const data = await fs.readFile(TECH_CONFIG_PATH, 'utf-8');
            res.json(JSON.parse(data));
        } catch (error) {
            logger.error({ err: error }, 'Failed to read technology config');
            res.status(500).json({ error: 'Failed to read technology config' });
        }
    });

    // POST /api/v1/technologies (requires API key)
    router.post('/technologies', async (req, res) => {
        const { technologies } = req.body;

        if (!Array.isArray(technologies) || technologies.length === 0) {
            return res.status(400).json({ error: 'technologies must be a non-empty array of strings' });
        }

        if (!technologies.every(t => typeof t === 'string')) {
            return res.status(400).json({ error: 'All technologies must be strings' });
        }

        try {
            const config = {
                filters: technologies.map(t => t.toLowerCase()),
                matchMode: 'any',
            };

            await fs.writeFile(TECH_CONFIG_PATH, JSON.stringify(config, null, 2) + '\n');
            logger.info({ count: config.filters.length, filters: config.filters }, 'Technology filters updated via API');
            res.json(config);
        } catch (error) {
            logger.error({ err: error }, 'Failed to update technology config');
            res.status(500).json({ error: 'Failed to update technology config' });
        }
    });

    // GET /api/v1/stats
    router.get('/stats', (req, res) => {
        const vulns = cache.getAll();
        const stats = {
            total: vulns.length,
            byStatus: {},
            bySeverity: {},
            bySource: {},
        };

        for (const v of vulns) {
            stats.byStatus[v.status || 'OPEN'] = (stats.byStatus[v.status || 'OPEN'] || 0) + 1;
            stats.bySeverity[v.severity] = (stats.bySeverity[v.severity] || 0) + 1;
            stats.bySource[v.source] = (stats.bySource[v.source] || 0) + 1;
        }

        res.json(stats);
    });

    // POST /api/v1/query — query vulns by technology
    router.post('/query', (req, res) => {
        const { technologies } = req.body;

        if (!Array.isArray(technologies)) {
            return res.status(400).json({ error: 'technologies must be an array' });
        }

        if (technologies.length === 0) {
            return res.status(400).json({ error: 'At least one technology required' });
        }

        logger.info({ techs: technologies }, 'Vulnerability query');
        const results = queryByTech(technologies, cache);
        res.json({ count: results.length, vulnerabilities: results });
    });

    return router;
}
