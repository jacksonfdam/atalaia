import config from './config.js';
import { getDb } from './cache/sqliteCache.js';
import logger from './logger.js';

/**
 * Runtime settings resolution: environment variable > database > config.json.
 *
 * Environment wins so that a deployment can always pin a value regardless of
 * what someone clicked in the console; the database layer is what the console
 * writes to; config.json remains the committed default.
 */

/**
 * @typedef {object} SettingDescriptor
 * @property {string} key        Dotted path, also the console's field name
 * @property {'boolean'|'string'|'number'} type
 * @property {string} [env]      Environment variable that overrides it
 * @property {(cfg: object) => unknown} fallback  Value from config.json
 * @property {string} label
 * @property {string} [help]
 */

/** Settings the console is allowed to write. Anything absent here is read-only. */
/** @type {SettingDescriptor[]} */
export const WRITABLE_SETTINGS = [
    {
        key: 'slack.enabled',
        type: 'boolean',
        env: 'SLACK_ENABLED',
        fallback: cfg => cfg.slack?.enabled === true,
        label: 'Slack notifications',
        help: 'When off, vulnerabilities are still collected and stored — only the outbound alert is skipped.',
    },
    {
        key: 'cronSchedule',
        type: 'string',
        env: 'CRON_SCHEDULE',
        fallback: cfg => cfg.cronSchedule ?? '0 * * * *',
        label: 'Monitoring schedule',
        help: 'Cron expression. Takes effect on the next service restart.',
    },
    {
        key: 'llm.provider',
        type: 'string',
        env: 'LLM_PROVIDER',
        fallback: cfg => cfg.llm?.provider ?? '',
        label: 'LLM provider',
        help: 'openai, ollama, or empty to disable plain-English explanations.',
    },
    {
        key: 'email.template',
        type: 'string',
        env: 'EMAIL_TEMPLATE',
        fallback: cfg => cfg.email?.template ?? 'professional',
        label: 'Weekly report template',
        help: 'professional or minimal.',
    },
    {
        key: 'email.recipients',
        type: 'string',
        env: 'EMAIL_RECIPIENTS',
        fallback: cfg => cfg.email?.recipients ?? '',
        label: 'Weekly report recipients',
        help: 'Comma-separated addresses.',
    },
    {
        key: 'repositories.autoScan',
        type: 'boolean',
        env: 'REPO_AUTO_SCAN',
        fallback: cfg => cfg.repositories?.autoScan === true,
        label: 'Scheduled repository scanning',
    },
    {
        key: 'repositories.scanCron',
        type: 'string',
        env: 'REPO_SCAN_CRON',
        fallback: cfg => cfg.repositories?.scanCron ?? '0 3 * * *',
        label: 'Repository scan schedule',
    },
];

const BY_KEY = new Map(WRITABLE_SETTINGS.map(setting => [setting.key, setting]));

/**
 * Credentials the console must be able to *check* but never read or write.
 * Exposed as booleans so an operator can tell a missing token from a wrong one
 * without the value ever crossing the wire.
 */
const SECRET_ENV_VARS = [
    { key: 'slack.webhookUrl', env: 'SLACK_WEBHOOK_URL', label: 'Slack webhook URL' },
    { key: 'slack.signingSecret', env: 'SLACK_SIGNING_SECRET', label: 'Slack signing secret' },
    { key: 'opencve.token', env: 'OPENCVE_API_TOKEN', label: 'OpenCVE API token' },
    { key: 'github.token', env: 'GITHUB_TOKEN', label: 'GitHub token' },
    { key: 'llm.apiKey', env: 'OPENAI_API_KEY', label: 'OpenAI API key' },
    { key: 'smtp.host', env: 'SMTP_HOST', label: 'SMTP host' },
    { key: 'api.key', env: 'API_KEY', label: 'API key' },
];

function coerce(type, raw) {
    if (type === 'boolean') {
        if (typeof raw === 'boolean') return raw;
        return String(raw).toLowerCase() === 'true';
    }
    if (type === 'number') {
        const parsed = Number(raw);
        if (Number.isNaN(parsed)) throw new Error(`Expected a number, got "${raw}"`);
        return parsed;
    }
    return String(raw);
}

function readOverride(key) {
    try {
        const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key);
        return row ? JSON.parse(row.value) : undefined;
    } catch (err) {
        // A missing settings table (an old database that has not been migrated)
        // must degrade to config.json rather than take the service down.
        logger.warn({ key, err }, 'Failed to read setting override, falling back to config');
        return undefined;
    }
}

/**
 * Resolve one setting through the full precedence chain.
 * @param {string} key
 */
export function getSetting(key) {
    const descriptor = BY_KEY.get(key);
    if (!descriptor) throw new Error(`Unknown setting: ${key}`);

    if (descriptor.env && process.env[descriptor.env] !== undefined) {
        return coerce(descriptor.type, process.env[descriptor.env]);
    }

    const override = readOverride(key);
    if (override !== undefined) return coerce(descriptor.type, override);

    return descriptor.fallback(config);
}

/**
 * Whether an environment variable is pinning this setting, in which case a
 * database write would be stored but never take effect.
 * @param {string} key
 */
export function isEnvLocked(key) {
    const descriptor = BY_KEY.get(key);
    return Boolean(descriptor?.env && process.env[descriptor.env] !== undefined);
}

/**
 * Persist an override.
 * @param {string} key
 * @param {unknown} value
 * @param {string} changedBy
 */
export function setSetting(key, value, changedBy) {
    const descriptor = BY_KEY.get(key);
    if (!descriptor) throw new Error(`Setting is not writable: ${key}`);

    const coerced = coerce(descriptor.type, value);

    getDb()
        .prepare(
            `INSERT INTO settings (key, value, updated_at, updated_by)
             VALUES (@key, @value, datetime('now'), @changedBy)
             ON CONFLICT(key) DO UPDATE SET
                value = excluded.value,
                updated_at = excluded.updated_at,
                updated_by = excluded.updated_by`
        )
        .run({ key, value: JSON.stringify(coerced), changedBy: changedBy ?? null });

    logger.info({ key, changedBy }, 'Setting updated');
    return coerced;
}

/** Remove an override so the value falls back to config.json. */
export function clearSetting(key) {
    if (!BY_KEY.has(key)) throw new Error(`Setting is not writable: ${key}`);
    getDb().prepare('DELETE FROM settings WHERE key = ?').run(key);
    logger.info({ key }, 'Setting override cleared');
}

/**
 * Everything the console needs to render the settings page: current values,
 * where each one came from, and which credentials are present.
 */
export function describeSettings() {
    let overrides = new Map();
    try {
        overrides = new Map(
            getDb().prepare('SELECT key, updated_at, updated_by FROM settings').all().map(row => [row.key, row])
        );
    } catch (err) {
        logger.warn({ err }, 'Failed to list setting overrides');
    }

    const settings = WRITABLE_SETTINGS.map(descriptor => {
        const envLocked = Boolean(descriptor.env && process.env[descriptor.env] !== undefined);
        const override = overrides.get(descriptor.key);

        return {
            key: descriptor.key,
            label: descriptor.label,
            help: descriptor.help ?? null,
            type: descriptor.type,
            value: getSetting(descriptor.key),
            // eslint-disable-next-line no-nested-ternary
            source: envLocked ? 'env' : override ? 'database' : 'config',
            // An env-pinned setting cannot be changed from the console; saying
            // so up front beats a write that silently has no effect.
            editable: !envLocked,
            envVar: descriptor.env ?? null,
            updatedAt: override?.updated_at ?? null,
            updatedBy: override?.updated_by ?? null,
        };
    });

    const credentials = SECRET_ENV_VARS.map(({ key, env, label }) => ({
        key,
        label,
        envVar: env,
        configured: Boolean(process.env[env]),
    }));

    return { settings, credentials };
}
