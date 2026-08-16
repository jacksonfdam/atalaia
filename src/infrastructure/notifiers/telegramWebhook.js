import logger from '../logger.js';
import { callTelegram } from './notifyTelegram.js';
import {
    resolveTelegramConfig,
    ensureWebhookSecret,
    readRegisteredWebhook,
    rememberRegisteredWebhook,
} from './telegramConfig.js';

/** Where Telegram should post its updates, given a public base URL. */
export function webhookPath(publicUrl) {
    return `${publicUrl.replace(/\/+$/, '')}/api/v1/telegram/webhook`;
}

/** The only ports Telegram will call. Everything else is refused outright. */
const ALLOWED_PORTS = new Set(['', '443', '80', '88', '8443']);

const PRIVATE_IPV4 = /^(10\.|127\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/;

/**
 * Would Telegram be able to call this?
 *
 * Telegram's own answer to a bad URL is "Failed to resolve host: Name or
 * service not known", which is true and useless: it does not say that the
 * address was a container name, or a laptop's localhost, or a port it refuses
 * to call. Checking here means the reason names the actual problem.
 *
 * @param {string} url
 * @returns {{ ok: boolean, reason?: string }}
 */
export function checkWebhookUrl(url) {
    let parsed;
    try {
        parsed = new URL(url);
    } catch {
        return { ok: false, reason: `"${url}" is not a URL` };
    }

    if (parsed.protocol !== 'https:') {
        return { ok: false, reason: 'Telegram only calls https:// addresses' };
    }

    const host = parsed.hostname.toLowerCase();

    if (host === 'localhost' || host === '::1' || host.endsWith('.local') || PRIVATE_IPV4.test(host)) {
        return {
            ok: false,
            reason: `${host} is only reachable from this machine — Telegram calls from the internet`,
        };
    }

    // A single label is a container or host name on some private network:
    // "atalaia", "api", "host.docker.internal". Telegram cannot resolve any of
    // them, which is exactly the error it returns.
    if (!host.includes('.')) {
        return {
            ok: false,
            reason: `${host} is not a public hostname — Telegram cannot resolve it`,
        };
    }

    if (!ALLOWED_PORTS.has(parsed.port)) {
        return {
            ok: false,
            reason: `Telegram only calls ports 443, 80, 88 and 8443, not ${parsed.port}`,
        };
    }

    return { ok: true };
}

/**
 * Point the bot at this instance.
 *
 * Telegram holds exactly one webhook per bot, so registering is also
 * un-registering whatever was there — which is why it is skipped when the URL
 * has not changed: a restart that hands out the same hostname should not
 * disturb a working webhook.
 *
 * @param {string} publicUrl Base URL of this API, as the internet sees it
 * @param {{ force?: boolean }} [options]
 * @returns {Promise<{ registered: boolean, url?: string, reason?: string }>}
 */
export async function registerTelegramWebhook(publicUrl, options = {}) {
    const config = await resolveTelegramConfig();

    // The token is what a webhook is registered against; a missing chat id only
    // means nothing can be sent *out* yet, which is a different question — so
    // the reason names the token rather than repeating the general one.
    if (!config.botToken) {
        return { registered: false, reason: 'No bot token: save one before registering a webhook' };
    }

    const url = webhookPath(publicUrl);

    // Checked before it is sent: Telegram's refusal names neither the address
    // nor what is wrong with it.
    const usable = checkWebhookUrl(url);
    if (!usable.ok) return { registered: false, url, reason: usable.reason };

    const current = await readRegisteredWebhook();

    if (!options.force && current.url === url) {
        return { registered: false, url, reason: 'Already registered at this URL' };
    }

    const secret = await ensureWebhookSecret();
    if (!secret) {
        return {
            registered: false,
            reason: 'No webhook secret could be stored — set TOKEN_ENCRYPTION_KEY (or API_KEY)',
        };
    }

    await callTelegram(config.botToken, 'setWebhook', {
        url,
        secret_token: secret,
        // Only what the buttons need. Every other update type would arrive,
        // be ignored, and cost a request each.
        allowed_updates: ['callback_query'],
        drop_pending_updates: true,
    });

    await rememberRegisteredWebhook(url);
    logger.info({ url }, 'Telegram webhook registered');

    return { registered: true, url };
}

/**
 * What Telegram thinks the webhook is — including the last delivery error,
 * which is the only place it is ever reported.
 */
export async function describeTelegramWebhook() {
    const config = await resolveTelegramConfig();
    if (!config.botToken) return null;

    const info = await callTelegram(config.botToken, 'getWebhookInfo', {});

    return {
        url: info.url || null,
        pendingUpdates: info.pending_update_count ?? 0,
        lastErrorAt: info.last_error_date ? new Date(info.last_error_date * 1000).toISOString() : null,
        lastErrorMessage: info.last_error_message ?? null,
    };
}

/** Stop Telegram calling a URL that no longer exists. */
export async function deleteTelegramWebhook() {
    const config = await resolveTelegramConfig();
    if (!config.botToken) return false;

    await callTelegram(config.botToken, 'deleteWebhook', { drop_pending_updates: false });
    await rememberRegisteredWebhook(null);
    logger.info('Telegram webhook removed');

    return true;
}
