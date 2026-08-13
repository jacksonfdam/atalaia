import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import logger from '../../infrastructure/logger.js';

const TECH_CONFIG_PATH = path.resolve('config/technologies.json');

export function createTechnologyRoutes() {
    const router = express.Router();

    // GET /technologies
    router.get('/', async (_req, res) => {
        try {
            const data = await fs.readFile(TECH_CONFIG_PATH, 'utf-8');
            res.json(JSON.parse(data));
        } catch (error) {
            logger.error({ err: error }, 'Failed to read technology config');
            res.status(500).json({ error: 'Failed to read technology config' });
        }
    });

    // POST /technologies
    router.post('/', async (req, res) => {
        const { technologies } = req.body ?? {};

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
            logger.info(
                { count: config.filters.length, filters: config.filters },
                'Technology filters updated via API'
            );
            res.json(config);
        } catch (error) {
            logger.error({ err: error }, 'Failed to update technology config');
            res.status(500).json({ error: 'Failed to update technology config' });
        }
    });

    return router;
}
