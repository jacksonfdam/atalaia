import crypto from 'node:crypto';
import logger from '../../infrastructure/logger.js';
import { acknowledgeVuln } from '../../application/acknowledgeVuln.js';
import { resolveVuln } from '../../application/resolveVuln.js';
import { resolveWebhookSecret, resolveTelegramConfig } from '../../infrastructure/notifiers/telegramConfig.js';
import { callTelegram, escapeHtml } from '../../infrastructure/notifiers/notifyTelegram.js';

/**
 * The Acknowledge and Resolve buttons, coming back from Telegram.
 *
 * Telegram signs nothing. What it offers is a secret chosen at registration and
 * returned in X-Telegram-Bot-Api-Secret-Token on every callback — so that
 * header is the whole of the authentication here, and a configuration without a
 * stored secret accepts nothing rather than accepting everything.
 */

/** Constant-time, and length-safe: timingSafeEqual throws on a length mismatch. */
export function secretMatches(expected, received) {
    if (!expected || !received) return false;

    const a = Buffer.from(String(expected));
    const b = Buffer.from(String(received));
    if (a.length !== b.length) return false;

    return crypto.timingSafeEqual(a, b);
}

export async function requireTelegramSecret(req, res, next) {
    const expected = await resolveWebhookSecret();

    if (!expected) {
        logger.error('No Telegram webhook secret stored; rejecting the callback');
        return res.status(500).json({ error: 'Server misconfigured' });
    }

    if (!secretMatches(expected, req.headers['x-telegram-bot-api-secret-token'])) {
        logger.warn({ ip: req.ip }, 'Invalid Telegram webhook secret');
        return res.status(401).json({ error: 'Unauthorized' });
    }

    next();
}

/** `ack:CVE-2024-0001` — the button's callback_data. */
export function parseCallbackData(data) {
    const [action, cveId] = String(data ?? '').split(':');
    if (!cveId) return null;
    if (action !== 'ack' && action !== 'resolve') return null;

    return { action, cveId };
}

function describeUser(from) {
    if (!from) return 'unknown';
    return from.username ? `@${from.username}` : String(from.id);
}

/**
 * Handle one update from Telegram.
 *
 * Telegram retries an update it considers undelivered, so this answers 200 for
 * anything it has finished with — including a button it does not recognise.
 * Failing loudly here would mean the same click arriving again and again.
 *
 * @param {{ get: Function, update: Function }} cache
 */
export function createTelegramUpdateHandler(cache) {
    return async (req, res) => {
        const callback = req.body?.callback_query;

        // Anything else — a plain message, a channel post, a bot added to a
        // group — is not ours to act on, and is not an error either.
        if (!callback) return res.json({ ok: true });

        const parsed = parseCallbackData(callback.data);
        const config = await resolveTelegramConfig();

        // Answering the callback is what stops the button's spinner. It is best
        // effort: the status change matters more than the toast.
        const answer = async text => {
            if (!config.botToken) return;
            try {
                await callTelegram(config.botToken, 'answerCallbackQuery', {
                    callback_query_id: callback.id,
                    text,
                });
            } catch (err) {
                logger.debug({ err }, 'Could not answer the Telegram callback');
            }
        };

        if (!parsed) {
            await answer('Unknown action');
            return res.json({ ok: true });
        }

        const { action, cveId } = parsed;
        const who = describeUser(callback.from);
        const changedBy = `telegram:${who}`;

        try {
            const result =
                action === 'ack'
                    ? await acknowledgeVuln(cveId, changedBy, cache)
                    : await resolveVuln(cveId, changedBy, cache);

            const status = result?.vuln?.status ?? (action === 'ack' ? 'ACKNOWLEDGED' : 'RESOLVED');
            logger.info({ cveId, who, action }, 'Vulnerability status changed via Telegram');

            await answer(`${cveId} is now ${status}`);

            // The message keeps its text and loses its buttons: a finished
            // decision should not offer itself again, and editing the text
            // would throw away the advisory somebody may still be reading.
            if (config.botToken && callback.message) {
                try {
                    await callTelegram(config.botToken, 'editMessageReplyMarkup', {
                        chat_id: callback.message.chat.id,
                        message_id: callback.message.message_id,
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: `${status} by ${escapeHtml(who)}`, callback_data: 'noop' }],
                            ],
                        },
                    });
                } catch (err) {
                    logger.debug({ err, cveId }, 'Could not update the Telegram message');
                }
            }
        } catch (error) {
            logger.warn({ cveId, who, err: error }, 'Telegram action failed');
            await answer(error.message);
        }

        res.json({ ok: true });
    };
}
