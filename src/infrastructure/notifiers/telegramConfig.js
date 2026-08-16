import crypto from 'node:crypto';
import { query, queryOne } from '../db/pool.js';
import { encrypt, decrypt, maskSecret, canEncrypt } from '../crypto.js';
import logger from '../logger.js';

/**
 * Where alerts go on Telegram, and what proves a callback came from Telegram.
 *
 * Same precedence as everywhere else: TELEGRAM_BOT_TOKEN in the environment
 * wins, then this table.
 *
 * Telegram has no request signature. What it offers instead is a secret token
 * chosen when the webhook is registered and returned in a header on every
 * callback, so Atalaia generates one, stores it encrypted, and compares it in
 * constant time. A configuration with no secret accepts nothing.
 */

async function readRow() {
    try {
        return await queryOne('SELECT * FROM telegram_config WHERE id = 1');
    } catch (err) {
        logger.warn({ err }, 'Failed to read the Telegram configuration');
        return null;
    }
}

export function isEnvConfigured() {
    return Boolean(process.env.TELEGRAM_BOT_TOKEN);
}

/** A bot token looks like 123456789:AA… — the digits are the bot's own id. */
export function looksLikeBotToken(token) {
    return /^\d{5,}:[A-Za-z0-9_-]{30,}$/.test(String(token ?? '').trim());
}

/**
 * @returns {Promise<{ ready: boolean, reason?: string, source: 'env'|'database'|'none',
 *                     botToken?: string, chatId?: string, notifyOwners?: boolean }>}
 */
export async function resolveTelegramConfig() {
    const envSwitch =
        process.env.TELEGRAM_ENABLED === undefined ? null : process.env.TELEGRAM_ENABLED === 'true';

    if (isEnvConfigured()) {
        const row = await readRow();
        // The chat id may still come from the console: a token pinned in the
        // environment does not pin where the messages go.
        const chatId = process.env.TELEGRAM_CHAT_ID || row?.chat_id || null;
        const enabled = envSwitch ?? true;

        const missing = [];
        if (!enabled) missing.push('Telegram notifications are switched off');
        if (!chatId) missing.push('no chat id');

        return {
            ready: missing.length === 0,
            reason: missing.length > 0 ? missing.join(', ') : undefined,
            source: 'env',
            botToken: process.env.TELEGRAM_BOT_TOKEN,
            chatId,
            notifyOwners: Boolean(row?.notify_owners),
        };
    }

    const row = await readRow();
    if (!row) return { ready: false, reason: 'Telegram is not configured', source: 'none' };

    let botToken = null;
    if (row.bot_token_cipher) {
        try {
            botToken = decrypt(row.bot_token_cipher);
        } catch (err) {
            logger.error({ err }, 'Failed to decrypt the Telegram bot token');
            return {
                ready: false,
                reason: 'Stored bot token cannot be decrypted — TOKEN_ENCRYPTION_KEY (or API_KEY) changed',
                source: 'database',
            };
        }
    }

    const missing = [];
    if (envSwitch === false) missing.push('TELEGRAM_ENABLED=false in the environment');
    else if (!row.enabled) missing.push('Telegram notifications are switched off');
    if (!botToken) missing.push('no bot token');
    if (!row.chat_id) missing.push('no chat id');

    return {
        ready: missing.length === 0,
        reason: missing.length > 0 ? missing.join(', ') : undefined,
        source: 'database',
        botToken,
        chatId: row.chat_id,
        notifyOwners: Boolean(row.notify_owners),
    };
}

/**
 * The secret Telegram returns on every callback.
 * @returns {Promise<string|null>}
 */
export async function resolveWebhookSecret() {
    const row = await readRow();
    if (!row?.webhook_secret_cipher) return null;

    try {
        return decrypt(row.webhook_secret_cipher);
    } catch (err) {
        logger.error({ err }, 'Failed to decrypt the Telegram webhook secret');
        return null;
    }
}

/**
 * The secret, generating and storing one the first time it is asked for.
 *
 * Rotating it on every restart would break the webhook Telegram already holds
 * until it is re-registered, so it is written once and reused.
 *
 * @returns {Promise<string|null>} null when secrets cannot be encrypted at rest
 */
export async function ensureWebhookSecret() {
    const existing = await resolveWebhookSecret();
    if (existing) return existing;

    if (!canEncrypt()) {
        logger.warn('Cannot store a Telegram webhook secret: set TOKEN_ENCRYPTION_KEY (or API_KEY)');
        return null;
    }

    const secret = crypto.randomBytes(32).toString('hex');

    await query(
        `INSERT INTO telegram_config (id, webhook_secret_cipher, updated_at)
         VALUES (1, @cipher, now())
         ON CONFLICT (id) DO UPDATE SET webhook_secret_cipher = excluded.webhook_secret_cipher`,
        { cipher: encrypt(secret) }
    );

    logger.info('Generated a Telegram webhook secret');
    return secret;
}

/** What Telegram was last told, so a restart can tell whether it changed. */
export async function readRegisteredWebhook() {
    const row = await readRow();
    return { url: row?.webhook_url ?? null, setAt: row?.webhook_set_at ?? null };
}

export async function rememberRegisteredWebhook(url) {
    await query(
        `INSERT INTO telegram_config (id, webhook_url, webhook_set_at, updated_at)
         VALUES (1, @url, now(), now())
         ON CONFLICT (id) DO UPDATE SET
            webhook_url = excluded.webhook_url,
            webhook_set_at = excluded.webhook_set_at`,
        { url }
    );
}

/** Everything the console renders. Never the token. */
export async function describeTelegramConfig() {
    const row = await readRow();
    const resolved = await resolveTelegramConfig();

    return {
        config: {
            hasToken: Boolean(row?.bot_token_cipher) || isEnvConfigured(),
            tokenHint: row?.bot_token_hint ?? null,
            chatId: row?.chat_id ?? null,
            notifyOwners: Boolean(row?.notify_owners),
            enabled: Boolean(row?.enabled),
            updatedAt: row?.updated_at ?? null,
            updatedBy: row?.updated_by ?? null,
        },
        webhook: {
            registered: Boolean(row?.webhook_url),
            url: row?.webhook_url ?? null,
            setAt: row?.webhook_set_at ?? null,
            hasSecret: Boolean(row?.webhook_secret_cipher),
        },
        envLocked: isEnvConfigured(),
        envVars: ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'TELEGRAM_ENABLED'],
        status: { ready: resolved.ready, reason: resolved.reason ?? null, source: resolved.source },
    };
}

/**
 * @param {{ botToken?: string, chatId?: string, notifyOwners?: boolean, enabled?: boolean }} input
 * @param {string} [changedBy]
 */
export async function saveTelegramConfig(input, changedBy) {
    if (input.botToken && !looksLikeBotToken(input.botToken)) {
        throw new Error('That does not look like a bot token — BotFather issues 123456789:AA…');
    }

    const current = await readRow();

    let cipher = current?.bot_token_cipher ?? null;
    let hint = current?.bot_token_hint ?? null;

    if (input.botToken !== undefined) {
        if (input.botToken) {
            if (!canEncrypt()) {
                throw new Error(
                    'Cannot store the bot token: set TOKEN_ENCRYPTION_KEY (or API_KEY) so it can be encrypted at rest'
                );
            }
            cipher = encrypt(input.botToken);
            hint = maskSecret(input.botToken);
        } else {
            cipher = null;
            hint = null;
        }
    }

    await query(
        `INSERT INTO telegram_config (id, bot_token_cipher, bot_token_hint, chat_id, notify_owners, enabled, updated_at, updated_by)
         VALUES (1, @cipher, @hint, @chatId, @notifyOwners, @enabled, now(), @changedBy)
         ON CONFLICT (id) DO UPDATE SET
            bot_token_cipher = excluded.bot_token_cipher,
            bot_token_hint = excluded.bot_token_hint,
            chat_id = excluded.chat_id,
            notify_owners = excluded.notify_owners,
            enabled = excluded.enabled,
            updated_at = excluded.updated_at,
            updated_by = excluded.updated_by`,
        {
            cipher,
            hint,
            chatId: input.chatId === undefined ? current?.chat_id ?? null : input.chatId || null,
            notifyOwners:
                input.notifyOwners === undefined
                    ? Boolean(current?.notify_owners)
                    : Boolean(input.notifyOwners),
            enabled: input.enabled === undefined ? Boolean(current?.enabled) : Boolean(input.enabled),
            changedBy: changedBy ?? null,
        }
    );

    logger.info({ changedBy }, 'Telegram configuration saved');
    return await describeTelegramConfig();
}
