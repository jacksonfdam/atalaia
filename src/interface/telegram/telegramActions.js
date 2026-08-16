import crypto from 'node:crypto';
import logger from '../../infrastructure/logger.js';
import { acknowledgeVuln } from '../../application/acknowledgeVuln.js';
import { resolveVuln } from '../../application/resolveVuln.js';
import { resolveWebhookSecret, resolveTelegramConfig } from '../../infrastructure/notifiers/telegramConfig.js';
import { callTelegram, escapeHtml } from '../../infrastructure/notifiers/notifyTelegram.js';
import { rememberChat } from '../../infrastructure/cache/telegramChatStore.js';

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
 * Answer a message with the chat's own id.
 *
 * This is the whole reason the bot listens to messages at all: "chat not found"
 * is what Telegram says until it has one, and there is no way to look it up.
 */
async function replyWithChatId(message) {
    const config = await resolveTelegramConfig();
    if (!config.botToken) return;

    // Anyone who finds the bot's @name can write to it. While no destination is
    // configured that is the setup conversation and it gets an answer; once one
    // is, strangers get silence rather than a bot that echoes ids on demand.
    if (config.chatId && String(message.chat.id) !== String(config.chatId)) {
        logger.debug({ chatId: message.chat.id }, 'Ignoring a message from an unconfigured chat');
        return;
    }

    try {
        await callTelegram(config.botToken, 'sendMessage', {
            chat_id: message.chat.id,
            parse_mode: 'HTML',
            text:
                `👋 <b>Atalaia</b>\n\nThis chat's id is <code>${escapeHtml(message.chat.id)}</code>.\n` +
                'Paste it into Settings → Telegram to receive alerts here.',
        });
    } catch (err) {
        logger.debug({ err }, 'Could not answer with the chat id');
    }
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
        const message = req.body?.message ?? req.body?.channel_post;

        // Somebody wrote to the bot. That is how a chat id comes into
        // existence, so it is remembered and answered with itself: the id is
        // the one setting nobody can look up anywhere else.
        if (message?.chat) {
            const config = await resolveTelegramConfig();

            // Only chats that could plausibly be a destination: the configured
            // one, or anyone at all while none is configured yet.
            if (!config.chatId || String(message.chat.id) === String(config.chatId)) {
                await rememberChat(message.chat);
            }

            await replyWithChatId(message);
            return res.json({ ok: true });
        }

        const callback = req.body?.callback_query;

        // Anything else — a bot added to a group, an edited message — is not
        // ours to act on, and is not an error either.
        if (!callback) return res.json({ ok: true });

        // A button press also proves the chat exists.
        if (callback.message?.chat) await rememberChat(callback.message.chat);

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
