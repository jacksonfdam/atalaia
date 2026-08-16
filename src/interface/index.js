// src/interface/index.js
import dotenv from "dotenv";
import logger from "../infrastructure/logger.js";
import { initializeDatabase } from "../infrastructure/cache/postgresCache.js";
import * as cache from "../infrastructure/cache/postgresCache.js";
import { createApp } from "./http/createApp.js";
import { establishCallbackUrl } from "../infrastructure/callbackUrls.js";
import { checkWebauthnConfig } from "../infrastructure/auth/webauthnConfig.js";
import { reconcileRpId } from "../infrastructure/auth/authState.js";

// quiet: dotenv v17 otherwise prints a banner that breaks the structured log stream
dotenv.config({ quiet: true });

// Migrations before anything serves a request. Top-level await: an ES module
// entry point can do this, and starting the server on an unmigrated database
// only moves the failure to the first query.
await initializeDatabase();

// Sign-in configuration, checked before anything can try to use it. A relying
// party id the browser would reject is not a degraded login, it is no login,
// and the error surfaces in a browser console rather than here.
const webauthn = checkWebauthnConfig();

if (!webauthn.ok) {
    logger.fatal({ reason: webauthn.error }, 'Refusing to start: passkey configuration is invalid');
    process.exit(1);
}

await reconcileRpId(webauthn.config.rpID);

const app = createApp(cache);

// Start server
const HOST = process.env.HOST || '0.0.0.0';
const PORT = process.env.PORT || 3000;

app.listen(PORT, HOST, async () => {
    logger.info({ host: HOST, port: PORT }, 'Atalaia server running');

    // Where the chat integrations should call back: PUBLIC_URL, or a tunnel.
    // Logged as one line so `atalaia.sh up` and `docker logs` both show the
    // address without anyone having to ask the API for it.
    const callback = await establishCallbackUrl(PORT);

    if (callback.url) {
        logger.info(
            { url: callback.url, source: callback.source, provider: callback.provider },
            'Callbacks reach this instance'
        );
    }

    // No scheduler and no first cycle here any more: both belong to the worker
    // process, which is the only thing that takes jobs off the queue. Two API
    // containers used to mean two of every scheduled run.
});
