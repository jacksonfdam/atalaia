import { query, queryOne } from '../db/pool.js';
import { encrypt, decrypt, maskSecret, canEncrypt } from '../crypto.js';
import logger from '../logger.js';

/**
 * Where alerts go on Discord.
 *
 * Same precedence as everywhere else: DISCORD_WEBHOOK_URL in the environment
 * wins, then this table. Same shape as Teams — an incoming webhook bound to one
 * channel, with no way for the channel to call back.
 */

async function readRow() {
    try {
        return await queryOne('SELECT * FROM discord_config WHERE id = 1');
    } catch (err) {
        logger.warn({ err }, 'Failed to read the Discord configuration');
        return null;
    }
}

export function isEnvConfigured() {
    return Boolean(process.env.DISCORD_WEBHOOK_URL);
}

/**
 * @returns {{ ready: boolean, reason?: string, source: 'env'|'database'|'none', webhookUrl?: string }}
 */
export async function resolveDiscordConfig() {
    const envSwitch = process.env.DISCORD_ENABLED === undefined ? null : process.env.DISCORD_ENABLED === 'true';

    if (isEnvConfigured()) {
        const enabled = envSwitch ?? true;
        return {
            ready: enabled,
            reason: enabled ? undefined : 'Discord notifications are switched off',
            source: 'env',
            webhookUrl: process.env.DISCORD_WEBHOOK_URL,
        };
    }

    const row = await readRow();
    if (!row) return { ready: false, reason: 'Discord is not configured', source: 'none' };

    let webhookUrl = null;
    if (row.webhook_cipher) {
        try {
            webhookUrl = decrypt(row.webhook_cipher);
        } catch (err) {
            logger.error({ err }, 'Failed to decrypt the Discord webhook');
            return {
                ready: false,
                reason: 'Stored webhook cannot be decrypted — TOKEN_ENCRYPTION_KEY (or API_KEY) changed',
                source: 'database',
            };
        }
    }

    const missing = [];
    if (envSwitch === false) missing.push('DISCORD_ENABLED=false in the environment');
    else if (!row.enabled) missing.push('Discord notifications are switched off');
    if (!webhookUrl) missing.push('no webhook URL');

    return {
        ready: missing.length === 0,
        reason: missing.length > 0 ? missing.join(', ') : undefined,
        source: 'database',
        webhookUrl,
    };
}

/** Everything the console renders. Never the URL. */
export async function describeDiscordConfig() {
    const row = await readRow();
    const resolved = await resolveDiscordConfig();

    return {
        config: {
            hasWebhook: Boolean(row?.webhook_cipher),
            webhookHint: row?.webhook_hint ?? null,
            enabled: Boolean(row?.enabled),
            updatedAt: row?.updated_at ?? null,
            updatedBy: row?.updated_by ?? null,
        },
        envLocked: isEnvConfigured(),
        envVars: ['DISCORD_WEBHOOK_URL', 'DISCORD_ENABLED'],
        status: { ready: resolved.ready, reason: resolved.reason ?? null, source: resolved.source },
    };
}

/**
 * @param {{ webhookUrl?: string, enabled?: boolean }} input
 * @param {string} [changedBy]
 */
export async function saveDiscordConfig(input, changedBy) {
    // discord.com is current, discordapp.com is the old host and still works,
    // and ptb/canary are the other release channels people copy from.
    if (
        input.webhookUrl &&
        !/^https:\/\/(canary\.|ptb\.)?discord(app)?\.com\/api\/webhooks\//i.test(input.webhookUrl)
    ) {
        throw new Error('That does not look like a Discord webhook URL (discord.com/api/webhooks/…)');
    }

    const current = await readRow();

    let cipher = current?.webhook_cipher ?? null;
    let hint = current?.webhook_hint ?? null;

    if (input.webhookUrl !== undefined) {
        if (input.webhookUrl) {
            if (!canEncrypt()) {
                throw new Error(
                    'Cannot store the webhook: set TOKEN_ENCRYPTION_KEY (or API_KEY) so it can be encrypted at rest'
                );
            }
            cipher = encrypt(input.webhookUrl);
            hint = maskSecret(input.webhookUrl);
        } else {
            cipher = null;
            hint = null;
        }
    }

    await query(
        `INSERT INTO discord_config (id, webhook_cipher, webhook_hint, enabled, updated_at, updated_by)
         VALUES (1, @cipher, @hint, @enabled, now(), @changedBy)
         ON CONFLICT (id) DO UPDATE SET
            webhook_cipher = excluded.webhook_cipher,
            webhook_hint = excluded.webhook_hint,
            enabled = excluded.enabled,
            updated_at = excluded.updated_at,
            updated_by = excluded.updated_by`,
        {
            cipher,
            hint,
            enabled: input.enabled === undefined ? Boolean(current?.enabled) : Boolean(input.enabled),
            changedBy: changedBy ?? null,
        }
    );

    logger.info({ changedBy }, 'Discord configuration saved');
    return await describeDiscordConfig();
}
