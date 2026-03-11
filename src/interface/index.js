// src/interface/index.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import logger from "../infrastructure/logger.js";
import startScheduler from "../infrastructure/scheduler.js";
import monitorVulns from "../application/monitorVulns.js";
import { initializeDatabase } from "../infrastructure/cache/sqliteCache.js";
import * as cache from "../infrastructure/cache/sqliteCache.js";
import { createApiRoutes } from "./http/apiRoutes.js";
import { requireSlackSignature, createSlackActionHandler } from "./slack/slackActions.js";
import { startNgrokTunnel, stopNgrokTunnel } from "../infrastructure/ngrokClient.js";
import { updateSlackRequestUrl } from "../infrastructure/slackUrlUpdater.js";

dotenv.config();

// Initialize Database (Migrations)
initializeDatabase();

const app = express();

// Security headers
app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-XSS-Protection", "1; mode=block");
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    res.setHeader("X-Permitted-Cross-Domain-Policies", "none");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    next();
});

// CORS
const allowedOrigins = (process.env.CORS_ORIGINS || "http://localhost:3000").split(",");
app.use(cors({ origin: allowedOrigins, credentials: true }));

// Capture raw body for Slack signature verification, then parse JSON/urlencoded
app.use(express.json({
    verify: (req, _res, buf) => { req.rawBody = buf.toString(); },
}));
app.use(express.urlencoded({
    extended: true,
    verify: (req, _res, buf) => { req.rawBody = buf.toString(); },
}));

// Healthcheck endpoint
app.get("/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Slack interactive actions endpoint (before API routes to avoid API key middleware)
app.post("/api/v1/slack/actions", requireSlackSignature, createSlackActionHandler(cache));

// REST API v1
app.use("/api/v1", createApiRoutes(cache));

// Start server
const HOST = process.env.HOST || '0.0.0.0';
const PORT = process.env.PORT || 3000;

app.listen(PORT, HOST, async () => {
    logger.info({ host: HOST, port: PORT }, 'Atalaia server running');

    // Setup ngrok tunnel and Slack integration (development only)
    if (process.env.NODE_ENV !== 'production') {
        try {
            const ngrokAuthToken = process.env.NGROK_AUTH_TOKEN;
            const ngrokRegion = process.env.NGROK_REGION || 'auto';
            const slackAppToken = process.env.SLACK_APP_TOKEN;
            const slackAppId = process.env.SLACK_APP_ID;

            const ngrokUrl = await startNgrokTunnel(PORT, ngrokAuthToken, ngrokRegion);

            if (ngrokUrl) {
                logger.info({ url: ngrokUrl }, 'ngrok tunnel established');

                // Try to update Slack with the new Request URL
                const slackUpdated = await updateSlackRequestUrl(ngrokUrl, slackAppToken, slackAppId);
                if (slackUpdated) {
                    logger.info('Slack Request URL configured successfully');
                }
            }
        } catch (error) {
            logger.warn({ err: error }, 'Failed to setup ngrok/Slack integration');
            // Continue anyway — app is still functional
        }
    }

    // Run scheduler
    startScheduler();

    // Run an immediate first cycle
    monitorVulns();
});