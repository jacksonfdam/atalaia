import { query, queryOne } from '../db/pool.js';
import { encrypt, decrypt, maskSecret, canEncrypt } from '../crypto.js';
import { getProvider, listProviders } from './emailProviders.js';
import logger from '../logger.js';

/**
 * Where the weekly report gets sent, and with which credentials.
 *
 * Resolution order matches the rest of Atalaia: environment variables win, the
 * database is what the console writes, and neither being set means email is
 * off. A deployment that pins SMTP_* in the environment therefore behaves
 * exactly as it did before this table existed.
 */

/** Environment variables that pin the whole configuration. */
const ENV_KEYS = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'EMAIL_FROM', 'EMAIL_RECIPIENTS', 'EMAIL_TEMPLATE'];

async function readRow() {
    try {
        return await queryOne('SELECT * FROM email_config WHERE id = 1');
    } catch (err) {
        // An un-migrated database must not take the monitoring cycle down.
        logger.warn({ err }, 'Failed to read email configuration');
        return null;
    }
}

function splitRecipients(value) {
    return String(value ?? '')
        .split(',')
        .map(entry => entry.trim())
        .filter(Boolean);
}

/** Whether SMTP_HOST is pinning delivery from the environment. */
export function isEnvConfigured() {
    return Boolean(process.env.SMTP_HOST);
}

/**
 * The effective configuration, secret included. Only the notifier calls this.
 *
 * @returns {{ ready: boolean, reason?: string, source: 'env'|'database'|'none',
 *             provider: string, host?: string, port?: number, username?: string,
 *             password?: string, from: string, recipients: string[], template: string }}
 */
export async function resolveEmailConfig() {
    if (isEnvConfigured()) {
        const recipients = splitRecipients(process.env.EMAIL_RECIPIENTS);

        return {
            ready: recipients.length > 0,
            reason: recipients.length === 0 ? 'EMAIL_RECIPIENTS is not set' : undefined,
            source: 'env',
            provider: 'smtp',
            host: process.env.SMTP_HOST,
            port: parseInt(process.env.SMTP_PORT || '587', 10),
            username: process.env.SMTP_USER,
            password: process.env.SMTP_PASS,
            from: process.env.EMAIL_FROM || 'atalaia@localhost',
            recipients,
            template: (process.env.EMAIL_TEMPLATE || 'professional').toLowerCase(),
        };
    }

    const row = await readRow();
    if (!row) {
        return {
            ready: false,
            reason: 'No email provider configured',
            source: 'none',
            provider: 'smtp',
            from: 'atalaia@localhost',
            recipients: [],
            template: 'professional',
        };
    }

    const recipients = splitRecipients(row.recipients);
    let password = null;

    if (row.secret_cipher) {
        try {
            password = decrypt(row.secret_cipher);
        } catch (err) {
            logger.error({ err }, 'Failed to decrypt the email provider secret');
            return {
                ready: false,
                reason: 'Stored credential cannot be decrypted — TOKEN_ENCRYPTION_KEY (or API_KEY) changed',
                source: 'database',
                provider: row.provider,
                from: row.from_address || 'atalaia@localhost',
                recipients,
                template: row.template,
            };
        }
    }

    const missing = [];
    if (!row.enabled) missing.push('email delivery is switched off');
    if (recipients.length === 0) missing.push('no recipients');
    if (!row.from_address) missing.push('no sender address');

    return {
        ready: missing.length === 0,
        reason: missing.length > 0 ? missing.join(', ') : undefined,
        source: 'database',
        provider: row.provider,
        host: row.host,
        port: row.port,
        username: row.username,
        password,
        from: row.from_address || 'atalaia@localhost',
        recipients,
        template: (row.template || 'professional').toLowerCase(),
    };
}

/**
 * Everything the console needs to render the email section — the provider
 * catalog, the current values, and whether a secret is held. Never the secret.
 */
export async function describeEmailConfig() {
    const row = await readRow();
    const envLocked = isEnvConfigured();
    const resolved = await resolveEmailConfig();

    return {
        providers: listProviders(),
        config: {
            provider: row?.provider ?? 'smtp',
            host: row?.host ?? null,
            port: row?.port ?? null,
            username: row?.username ?? null,
            hasSecret: Boolean(row?.secret_cipher),
            secretHint: row?.secret_hint ?? null,
            from: row?.from_address ?? null,
            recipients: row?.recipients ?? null,
            template: row?.template ?? 'professional',
            enabled: Boolean(row?.enabled),
            updatedAt: row?.updated_at ?? null,
            updatedBy: row?.updated_by ?? null,
        },
        // An env-pinned deployment cannot be edited from here; saying so beats
        // a write that persists and changes nothing.
        envLocked,
        envVars: ENV_KEYS,
        status: {
            ready: resolved.ready,
            reason: resolved.reason ?? null,
            source: resolved.source,
            recipients: resolved.recipients.length,
        },
    };
}

/**
 * Persist the configuration.
 *
 * @param {object} input
 * @param {string} input.provider
 * @param {string} [input.host]
 * @param {number|string} [input.port]
 * @param {string} [input.username]
 * @param {string|null} [input.secret]  Omit to keep, empty string to clear
 * @param {string} [input.from]
 * @param {string} [input.recipients]   Comma-separated
 * @param {string} [input.template]
 * @param {boolean} [input.enabled]
 * @param {string} [changedBy]
 */
export async function saveEmailConfig(input, changedBy) {
    const descriptor = getProvider(input.provider);
    if (!descriptor) throw new Error(`Unknown email provider: ${input.provider}`);

    if (input.template && !['professional', 'minimal'].includes(input.template)) {
        throw new Error('template must be "professional" or "minimal"');
    }

    const current = await readRow();

    let cipher = current?.secret_cipher ?? null;
    let hint = current?.secret_hint ?? null;

    if (input.secret !== undefined) {
        if (input.secret) {
            if (!canEncrypt()) {
                throw new Error(
                    'Cannot store the credential: set TOKEN_ENCRYPTION_KEY (or API_KEY) so it can be encrypted at rest'
                );
            }
            cipher = encrypt(input.secret);
            hint = maskSecret(input.secret);
        } else {
            cipher = null;
            hint = null;
        }
    }

    // Switching provider keeps the stored secret only if the operator is
    // sending a new one — a SendGrid key is not a Mailgun password.
    if (current && current.provider !== descriptor.id && input.secret === undefined) {
        cipher = null;
        hint = null;
    }

    const port = input.port === undefined || input.port === '' ? descriptor.defaults.port ?? null : Number(input.port);
    if (port !== null && (!Number.isInteger(port) || port <= 0)) {
        throw new Error('port must be a positive integer');
    }

    await query(
        `INSERT INTO email_config
            (id, provider, host, port, username, secret_cipher, secret_hint,
             from_address, recipients, template, enabled, updated_at, updated_by)
         VALUES
            (1, @provider, @host, @port, @username, @cipher, @hint,
             @from, @recipients, @template, @enabled, now(), @changedBy)
         ON CONFLICT (id) DO UPDATE SET
            provider = excluded.provider,
            host = excluded.host,
            port = excluded.port,
            username = excluded.username,
            secret_cipher = excluded.secret_cipher,
            secret_hint = excluded.secret_hint,
            from_address = excluded.from_address,
            recipients = excluded.recipients,
            template = excluded.template,
            enabled = excluded.enabled,
            updated_at = excluded.updated_at,
            updated_by = excluded.updated_by`,
        {
            provider: descriptor.id,
            host: input.host ?? descriptor.defaults.host ?? null,
            port,
            username: input.username ?? descriptor.defaults.username ?? null,
            cipher,
            hint,
            from: input.from ?? current?.from_address ?? null,
            recipients: input.recipients ?? current?.recipients ?? null,
            template: (input.template ?? current?.template ?? 'professional').toLowerCase(),
            enabled: input.enabled === undefined ? Boolean(current?.enabled) : Boolean(input.enabled),
            changedBy: changedBy ?? null,
        }
    );

    logger.info({ provider: descriptor.id, changedBy }, 'Email configuration saved');
    return await describeEmailConfig();
}
