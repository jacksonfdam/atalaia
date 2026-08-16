import logger from './logger.js';
import { updateSlackRequestUrl } from './slackUrlUpdater.js';
import { resolveAppCredentials } from './notifiers/slackConfig.js';
import { registerTelegramWebhook } from './notifiers/telegramWebhook.js';
import { startTunnel, resolveTunnelProvider } from './tunnels/tunnelRegistry.js';

/**
 * Where the chat platforms should call back, and telling them.
 *
 * Slack and Telegram each hold their own copy of the URL, and both have to be
 * told again every time it changes — which, on a development tunnel, is every
 * restart. One place does it so a new integration is a line here rather than
 * another block in the process entry point.
 *
 * The answer is also kept, because the operator needs it: the address is only
 * known once the process is running, and a URL nobody can read is a tunnel that
 * might as well not be open.
 */

/** The last thing establishCallbackUrl() worked out, for whoever asks. */
let current = {
    url: null,
    source: 'none',
    provider: null,
    reason: null,
    establishedAt: null,
    published: { slack: false, telegram: false },
};

/**
 * An address the internet can already reach, if there is one.
 *
 * PUBLIC_URL is what a real deployment sets. It wins over any tunnel: a
 * hostname somebody owns should not be replaced by a throwaway one.
 *
 * @returns {string|null}
 */
export function resolvePublicUrl() {
    const url = process.env.PUBLIC_URL?.trim();
    if (!url) return null;

    return url.replace(/\/+$/, '');
}

/** What this process is reachable at, as far as it knows. */
export function currentCallbackUrl() {
    return { ...current };
}

/**
 * @param {string} publicUrl Base URL, no trailing slash
 * @returns {Promise<{ slack: boolean, telegram: boolean }>} Which platforms accepted it
 */
export async function publishCallbackUrl(publicUrl) {
    const results = { slack: false, telegram: false };

    try {
        // Environment first, then whatever the console stored.
        const { appToken, appId } = await resolveAppCredentials();
        results.slack = await updateSlackRequestUrl(publicUrl, appToken, appId);
    } catch (err) {
        logger.warn({ err }, 'Could not update the Slack request URL');
    }

    try {
        const telegram = await registerTelegramWebhook(publicUrl);
        results.telegram = telegram.registered;
        if (!telegram.registered && telegram.reason) {
            logger.debug({ reason: telegram.reason }, 'Telegram webhook not registered');
        }
    } catch (err) {
        logger.warn({ err }, 'Could not register the Telegram webhook');
    }

    logger.info({ publicUrl, ...results }, 'Callback URL published');
    return results;
}

/**
 * Work out this instance's public address, open a tunnel if that is what it
 * takes, and tell the chat platforms about it.
 *
 * Called once at boot. It never throws: a callback URL is a convenience, and an
 * API that refuses to serve requests because a tunnel failed is worse than one
 * whose buttons do not work yet.
 *
 * A tunnel is opened when TUNNEL_PROVIDER asks for one, or outside production
 * where there is no address to give anybody. Production without that variable
 * opens nothing: a public hostname is not something to hand out by accident.
 *
 * @param {number|string} port The port this API listens on
 * @returns {Promise<{ url: string|null, source: string, provider: string|null }>}
 */
export async function establishCallbackUrl(port) {
    const configured = resolvePublicUrl();

    if (configured) {
        current = {
            url: configured,
            source: 'PUBLIC_URL',
            provider: null,
            reason: null,
            establishedAt: new Date().toISOString(),
            published: await publishCallbackUrl(configured),
        };

        return currentCallbackUrl();
    }

    const wanted =
        process.env.TUNNEL_PROVIDER !== undefined || process.env.NODE_ENV !== 'production';

    if (!wanted) {
        current = {
            ...current,
            url: null,
            source: 'none',
            reason: 'No PUBLIC_URL, and no TUNNEL_PROVIDER to open a tunnel with',
        };

        logger.info({ reason: current.reason }, 'No callback URL — chat buttons will not reach this instance');
        return currentCallbackUrl();
    }

    // Said out loud before the await: the API answers /health the moment it is
    // listening, and a tunnel takes seconds longer. Without this, whoever asks
    // in that window cannot tell "no tunnel" from "not yet".
    current = {
        ...current,
        url: null,
        source: 'tunnel',
        provider: resolveTunnelProvider().provider?.name ?? null,
        reason: 'Opening the tunnel',
    };

    const tunnel = await startTunnel(port);

    if (!tunnel) {
        current = {
            ...current,
            url: null,
            source: 'none',
            reason: resolveTunnelProvider().reason ?? 'The tunnel did not start',
        };

        return currentCallbackUrl();
    }

    current = {
        url: tunnel.url,
        source: 'tunnel',
        provider: tunnel.provider,
        reason: null,
        establishedAt: new Date().toISOString(),
        published: await publishCallbackUrl(tunnel.url),
    };

    return currentCallbackUrl();
}
