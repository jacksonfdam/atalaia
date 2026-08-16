import express from 'express';
import cors from 'cors';
import { createApiRoutes } from './apiRoutes.js';
import { createMcpRoutes } from './mcpRoutes.js';
import { requireSlackSignature, createSlackActionHandler } from '../slack/slackActions.js';
import { requireTelegramSecret, createTelegramUpdateHandler } from '../telegram/telegramActions.js';

/**
 * Build the HTTP application.
 *
 * Kept separate from the process entry point so tests can mount the same app
 * without opening a port, starting the scheduler, or running a feed cycle.
 *
 * @param {object} cache postgresCache module (or a compatible stub)
 * @returns {import('express').Express}
 */
export function createApp(cache) {
    const app = express();

    // Security headers
    app.use((_req, res, next) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-Frame-Options', 'DENY');
        res.setHeader('X-XSS-Protection', '1; mode=block');
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
        res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
        res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
        next();
    });

    const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3000').split(',');
    app.use(cors({ origin: allowedOrigins, credentials: true }));

    // Capture raw body for Slack signature verification, then parse JSON/urlencoded
    app.use(
        express.json({
            verify: (req, _res, buf) => {
                req.rawBody = buf.toString();
            },
        })
    );
    app.use(
        express.urlencoded({
            extended: true,
            verify: (req, _res, buf) => {
                req.rawBody = buf.toString();
            },
        })
    );

    app.get('/health', (_req, res) => {
        res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    // Slack interactive actions — mounted before the API routes so it is not
    // caught by the API key middleware (Slack authenticates by signature).
    app.post('/api/v1/slack/actions', requireSlackSignature, createSlackActionHandler(cache));

    // Telegram's buttons, likewise: it authenticates with the secret token it
    // was given at registration, not with the API key.
    app.post('/api/v1/telegram/webhook', requireTelegramSecret, createTelegramUpdateHandler(cache));

    app.use('/api/v1', createApiRoutes(cache));

    // MCP, for agents. Outside /api/v1 because it is a protocol of its own
    // rather than another REST resource, but behind the same API key.
    app.use('/mcp', createMcpRoutes(cache));

    return app;
}
