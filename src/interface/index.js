// src/interface/index.js
import dotenv from "dotenv";
import logger from "../infrastructure/logger.js";
import { initializeDatabase } from "../infrastructure/cache/postgresCache.js";
import * as cache from "../infrastructure/cache/postgresCache.js";
import { createApp } from "./http/createApp.js";
import { startNgrokTunnel } from "../infrastructure/ngrokClient.js";
import { updateSlackRequestUrl } from "../infrastructure/slackUrlUpdater.js";
import { resolveAppCredentials } from "../infrastructure/notifiers/slackConfig.js";

// quiet: dotenv v17 otherwise prints a banner that breaks the structured log stream
dotenv.config({ quiet: true });

// Migrations before anything serves a request. Top-level await: an ES module
// entry point can do this, and starting the server on an unmigrated database
// only moves the failure to the first query.
await initializeDatabase();

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
            // Environment first, then whatever the console stored.
            const { appToken: slackAppToken, appId: slackAppId } = await resolveAppCredentials();

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

    // No scheduler and no first cycle here any more: both belong to the worker
    // process, which is the only thing that takes jobs off the queue. Two API
    // containers used to mean two of every scheduled run.
});
