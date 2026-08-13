import { getDb } from '../cache/sqliteCache.js';
import { encrypt, decrypt, maskSecret, canEncrypt } from '../crypto.js';
import config from '../config.js';
import logger from '../logger.js';

/**
 * Where vulnerability alerts go on Slack.
 *
 * Same precedence as everything else: SLACK_WEBHOOK_URL in the environment
 * wins, then this table, then config.json. An existing deployment that only
 * ever set the webhook keeps working with nothing to change.
 */

export const SLACK_MODES = ['webhook', 'bot'];

/** Slack's own identifier shapes, so a typo is caught before a send fails. */
const CHANNEL_ID = /^[CGD][A-Z0-9]{6,}$/;
const USER_ID = /^[UW][A-Z0-9]{6,}$/;

function readRow() {
    try {
        return getDb().prepare('SELECT * FROM slack_config WHERE id = 1').get() ?? null;
    } catch (err) {
        logger.warn({ err }, 'Failed to read Slack configuration');
        return null;
    }
}

/** Whether the environment is pinning the webhook. */
export function isEnvConfigured() {
    return Boolean(process.env.SLACK_WEBHOOK_URL);
}

/**
 * Classify a destination so the console can explain what it will do.
 * @param {string|null|undefined} destination
 */
export function describeDestination(destination) {
    const value = String(destination ?? '').trim();
    if (!value) return { kind: 'none', value: null };

    if (USER_ID.test(value)) return { kind: 'user', value };
    if (CHANNEL_ID.test(value)) return { kind: 'channel', value };
    if (value.startsWith('@')) return { kind: 'user', value };
    if (value.startsWith('#')) return { kind: 'channel', value };

    // Slack accepts a bare channel name; a bare user name it does not.
    return { kind: 'channel', value: `#${value}` };
}

/**
 * The effective configuration, credentials included. Only the notifier uses it.
 *
 * @returns {{ ready: boolean, reason?: string, source: 'env'|'database'|'config'|'none',
 *             mode: string, webhookUrl?: string, botToken?: string,
 *             destination?: string, notifyOwners: boolean }}
 */
export function resolveSlackConfig() {
    // One switch, not two: the row's `enabled` is the truth, and SLACK_ENABLED
    // can still force it either way from the environment.
    const envSwitch =
        process.env.SLACK_ENABLED === undefined ? null : process.env.SLACK_ENABLED === 'true';

    if (isEnvConfigured()) {
        // A webhook pinned in the environment is a deliberate act, so it counts
        // as on unless SLACK_ENABLED says otherwise.
        const enabled = envSwitch ?? true;
        return {
            ready: enabled,
            reason: enabled ? undefined : 'Slack notifications are switched off',
            source: 'env',
            mode: 'webhook',
            webhookUrl: process.env.SLACK_WEBHOOK_URL,
            notifyOwners: false,
        };
    }

    const row = readRow();

    if (!row) {
        // config.json may still carry a webhook from before this table existed.
        const fromConfig = config.slack?.webhookUrl;
        if (fromConfig) {
            const enabled = envSwitch ?? config.slack?.enabled === true;
            return {
                ready: enabled,
                reason: enabled ? undefined : 'Slack notifications are switched off',
                source: 'config',
                mode: 'webhook',
                webhookUrl: fromConfig,
                notifyOwners: false,
            };
        }

        return {
            ready: false,
            reason: 'Slack is not configured',
            source: 'none',
            mode: 'webhook',
            notifyOwners: false,
        };
    }

    let webhookUrl = null;
    let botToken = null;

    try {
        if (row.webhook_cipher) webhookUrl = decrypt(row.webhook_cipher);
        if (row.bot_cipher) botToken = decrypt(row.bot_cipher);
    } catch (err) {
        logger.error({ err }, 'Failed to decrypt the Slack credential');
        return {
            ready: false,
            reason: 'Stored credential cannot be decrypted — TOKEN_ENCRYPTION_KEY (or API_KEY) changed',
            source: 'database',
            mode: row.mode,
            notifyOwners: row.notify_owners === 1,
        };
    }

    const missing = [];
    if (envSwitch === false) missing.push('SLACK_ENABLED=false in the environment');
    else if (row.enabled !== 1) missing.push('Slack notifications are switched off');
    if (row.mode === 'webhook' && !webhookUrl) missing.push('no webhook URL');
    if (row.mode === 'bot' && !botToken) missing.push('no bot token');
    if (row.mode === 'bot' && !row.destination) missing.push('no channel or user to post to');

    return {
        ready: missing.length === 0,
        reason: missing.length > 0 ? missing.join(', ') : undefined,
        source: 'database',
        mode: row.mode,
        webhookUrl,
        botToken,
        destination: row.destination,
        notifyOwners: row.notify_owners === 1,
    };
}

/** Everything the console renders. Never a credential. */
export function describeSlackConfig() {
    const row = readRow();
    const resolved = resolveSlackConfig();
    const destination = describeDestination(row?.destination);

    return {
        modes: SLACK_MODES,
        config: {
            mode: row?.mode ?? 'webhook',
            hasWebhook: Boolean(row?.webhook_cipher),
            webhookHint: row?.webhook_hint ?? null,
            hasBotToken: Boolean(row?.bot_cipher),
            botHint: row?.bot_hint ?? null,
            destination: row?.destination ?? null,
            destinationKind: destination.kind,
            notifyOwners: row?.notify_owners === 1,
            enabled: row?.enabled === 1,
            updatedAt: row?.updated_at ?? null,
            updatedBy: row?.updated_by ?? null,
        },
        envLocked: isEnvConfigured(),
        envVars: ['SLACK_WEBHOOK_URL', 'SLACK_SIGNING_SECRET'],
        // Interactive buttons are verified by signature, which is env-only:
        // it is read on every inbound request, not by this service's outbound.
        interactivity: {
            configured: Boolean(process.env.SLACK_SIGNING_SECRET),
            envVar: 'SLACK_SIGNING_SECRET',
        },
        status: {
            ready: resolved.ready,
            reason: resolved.reason ?? null,
            source: resolved.source,
            mode: resolved.mode,
        },
    };
}

/**
 * Persist the configuration.
 *
 * @param {object} input
 * @param {'webhook'|'bot'} input.mode
 * @param {string} [input.webhookUrl]  Omit to keep, empty string to clear
 * @param {string} [input.botToken]    Omit to keep, empty string to clear
 * @param {string} [input.destination]
 * @param {boolean} [input.notifyOwners]
 * @param {boolean} [input.enabled]
 * @param {string} [changedBy]
 */
export function saveSlackConfig(input, changedBy) {
    if (!SLACK_MODES.includes(input.mode)) {
        throw new Error(`mode must be one of: ${SLACK_MODES.join(', ')}`);
    }

    if (input.webhookUrl && !/^https:\/\/hooks\.slack\.com\//.test(input.webhookUrl)) {
        throw new Error('The webhook URL must start with https://hooks.slack.com/');
    }

    if (input.botToken && !input.botToken.startsWith('xoxb-')) {
        throw new Error('A bot token starts with xoxb-');
    }

    const current = readRow();

    const secret = (value, currentCipher, currentHint) => {
        if (value === undefined) return { cipher: currentCipher ?? null, hint: currentHint ?? null };
        if (!value) return { cipher: null, hint: null };
        if (!canEncrypt()) {
            throw new Error(
                'Cannot store the credential: set TOKEN_ENCRYPTION_KEY (or API_KEY) so it can be encrypted at rest'
            );
        }
        return { cipher: encrypt(value), hint: maskSecret(value) };
    };

    const webhook = secret(input.webhookUrl, current?.webhook_cipher, current?.webhook_hint);
    const bot = secret(input.botToken, current?.bot_cipher, current?.bot_hint);

    const destination =
        input.destination === undefined
            ? current?.destination ?? null
            : describeDestination(input.destination).value;

    getDb()
        .prepare(
            `INSERT INTO slack_config
                (id, mode, webhook_cipher, webhook_hint, bot_cipher, bot_hint,
                 destination, notify_owners, enabled, updated_at, updated_by)
             VALUES
                (1, @mode, @webhookCipher, @webhookHint, @botCipher, @botHint,
                 @destination, @notifyOwners, @enabled, datetime('now'), @changedBy)
             ON CONFLICT(id) DO UPDATE SET
                mode = excluded.mode,
                webhook_cipher = excluded.webhook_cipher,
                webhook_hint = excluded.webhook_hint,
                bot_cipher = excluded.bot_cipher,
                bot_hint = excluded.bot_hint,
                destination = excluded.destination,
                notify_owners = excluded.notify_owners,
                enabled = excluded.enabled,
                updated_at = excluded.updated_at,
                updated_by = excluded.updated_by`
        )
        .run({
            mode: input.mode,
            webhookCipher: webhook.cipher,
            webhookHint: webhook.hint,
            botCipher: bot.cipher,
            botHint: bot.hint,
            destination,
            notifyOwners: input.notifyOwners ? 1 : 0,
            enabled: input.enabled === undefined ? current?.enabled ?? 0 : input.enabled ? 1 : 0,
            changedBy: changedBy ?? null,
        });

    logger.info({ mode: input.mode, destination, changedBy }, 'Slack configuration saved');
    return describeSlackConfig();
}
