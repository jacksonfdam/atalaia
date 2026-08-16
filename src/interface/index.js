// src/interface/index.js
import dotenv from "dotenv";
import logger from "../infrastructure/logger.js";
import { initializeDatabase } from "../infrastructure/cache/postgresCache.js";
import * as cache from "../infrastructure/cache/postgresCache.js";
import { createApp } from "./http/createApp.js";
import { startTunnel } from "../infrastructure/tunnels/tunnelRegistry.js";
import { publishCallbackUrl, resolvePublicUrl } from "../infrastructure/callbackUrls.js";

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

    // Where the chat integrations should call back.
    //
    // A real deployment sets PUBLIC_URL and needs no tunnel. A laptop has no
    // address to give Slack or Telegram, so one is borrowed — by default only
    // outside production, unless TUNNEL_PROVIDER says otherwise.
    try {
        const configured = resolvePublicUrl();
        const wantsTunnel =
            process.env.TUNNEL_PROVIDER !== undefined || process.env.NODE_ENV !== 'production';

        const tunnel = configured || !wantsTunnel ? null : await startTunnel(PORT);
        const publicUrl = configured ?? tunnel?.url ?? null;

        if (publicUrl) await publishCallbackUrl(publicUrl);
    } catch (error) {
        // A callback URL is a convenience: the API serves requests either way.
        logger.warn({ err: error }, 'Could not publish the callback URL');
    }

    // No scheduler and no first cycle here any more: both belong to the worker
    // process, which is the only thing that takes jobs off the queue. Two API
    // containers used to mean two of every scheduled run.
});
