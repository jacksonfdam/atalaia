import logger from '../infrastructure/logger.js';

/**
 * Express middleware requiring a valid API key in the X-API-Key header.
 */
export function requireApiKey(req, res, next) {
    const apiKey = req.headers['x-api-key'];
    const validKey = process.env.API_KEY;

    if (!validKey) {
        logger.error('API_KEY environment variable not set');
        return res.status(500).json({ error: 'Server misconfigured' });
    }

    if (!apiKey || apiKey !== validKey) {
        logger.warn({ path: req.path, ip: req.ip }, 'Unauthorized API request');
        return res.status(401).json({ error: 'Unauthorized' });
    }

    next();
}
