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
    // means nothing can be sent *out* yet, which is a different question.
    if (!config.botToken) {
        return { registered: false, reason: config.reason ?? 'Telegram is not configured' };
    }

    const url = webhookPath(publicUrl);
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
