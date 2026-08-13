// src/interface/index.js
import dotenv from "dotenv";
import logger from "../infrastructure/logger.js";
import startScheduler from "../infrastructure/scheduler.js";
import monitorVulns from "../application/monitorVulns.js";
import { initializeDatabase } from "../infrastructure/cache/sqliteCache.js";
import * as cache from "../infrastructure/cache/sqliteCache.js";
import { createApp } from "./http/createApp.js";
import { startNgrokTunnel } from "../infrastructure/ngrokClient.js";
import { updateSlackRequestUrl } from "../infrastructure/slackUrlUpdater.js";

// quiet: dotenv v17 otherwise prints a banner that breaks the structured log stream
dotenv.config({ quiet: true });

// Initialize Database (Migrations)
initializeDatabase();

const app = createApp(cache);

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
