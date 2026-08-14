import config from './config.js';
import { query, queryAll } from './db/pool.js';
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

/**
 * Settings the console is allowed to write. Anything absent here is read-only.
 *
 * Email, Slack and the LLM are deliberately not here: provider, credentials,
 * destination and the on/off switch belong together, and splitting them across
 * key/value rows would leave two switches to reconcile. They live in
 * email_config, slack_config and llm_config.
 */
/** @type {SettingDescriptor[]} */
export const WRITABLE_SETTINGS = [
    {
        key: 'cronSchedule',
        type: 'string',
        env: 'CRON_SCHEDULE',
        fallback: cfg => cfg.cronSchedule ?? '0 * * * *',
        label: 'Monitoring schedule',
        help: 'Cron expression. Takes effect on the next service restart.',
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
    // Fallback only: each organization normally carries its own token, stored
    // encrypted in the database and managed from the Organizations page.
    { key: 'github.token', env: 'GITHUB_TOKEN', label: 'GitHub token (fallback)' },
    // SMTP is deliberately absent: email delivery is configured in its own
    // section, and listing SMTP_HOST here as "MISSING" would read as broken
    // email when the provider is configured in the database instead.
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

/**
 * The overrides table, held in memory.
 *
 * These are read on paths that run per request and per scheduled job, and they
 * change when a human clicks Save. A round trip each time would be the wrong
 * trade — but the cache is shared with nobody, and the worker process writes to
 * the same table, so it also expires: a change made in one process is picked up
 * by the other within TTL_MS rather than at the next restart.
 */
let overrides = null;
let loadedAt = 0;
const TTL_MS = 30_000;

async function loadOverrides() {
    const fresh = overrides !== null && Date.now() - loadedAt < TTL_MS;
    if (fresh) return overrides;

    try {
        const rows = await queryAll('SELECT key, value FROM settings');
        overrides = new Map(rows.map(row => [row.key, JSON.parse(row.value)]));
        loadedAt = Date.now();
    } catch (err) {
        // An unmigrated database must degrade to config.json rather than take
        // the service down.
        logger.warn({ err }, 'Failed to read setting overrides, falling back to config');
        overrides = new Map();
        loadedAt = Date.now();
    }

    return overrides;
}

/** Drop the cache so the next read goes to the database. */
export function invalidateSettings() {
    overrides = null;
}

/**
 * Resolve one setting through the full precedence chain.
 * @param {string} key
 * @returns {Promise<unknown>}
 */
export async function getSetting(key) {
    const descriptor = BY_KEY.get(key);
    if (!descriptor) throw new Error(`Unknown setting: ${key}`);

    if (descriptor.env && process.env[descriptor.env] !== undefined) {
        return coerce(descriptor.type, process.env[descriptor.env]);
    }

    const override = (await loadOverrides()).get(key);
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
export async function setSetting(key, value, changedBy) {
    const descriptor = BY_KEY.get(key);
    if (!descriptor) throw new Error(`Setting is not writable: ${key}`);

    const coerced = coerce(descriptor.type, value);

    await query(
        `INSERT INTO settings (key, value, updated_at, updated_by)
         VALUES (@key, @value, now(), @changedBy)
         ON CONFLICT (key) DO UPDATE SET
            value = excluded.value,
            updated_at = excluded.updated_at,
            updated_by = excluded.updated_by`,
        { key, value: JSON.stringify(coerced), changedBy: changedBy ?? null }
    );

    invalidateSettings();
    logger.info({ key, changedBy }, 'Setting updated');
    return coerced;
}

/** Remove an override so the value falls back to config.json. */
export async function clearSetting(key) {
    if (!BY_KEY.has(key)) throw new Error(`Setting is not writable: ${key}`);
    await query('DELETE FROM settings WHERE key = @key', { key });
    invalidateSettings();
    logger.info({ key }, 'Setting override cleared');
}

/**
 * Everything the console needs to render the settings page: current values,
 * where each one came from, and which credentials are present.
 */
export async function describeSettings() {
    let stored = new Map();
    try {
        const rows = await queryAll('SELECT key, updated_at, updated_by FROM settings');
        stored = new Map(rows.map(row => [row.key, row]));
    } catch (err) {
        logger.warn({ err }, 'Failed to list setting overrides');
    }

    const settings = await Promise.all(WRITABLE_SETTINGS.map(async descriptor => {
        const envLocked = Boolean(descriptor.env && process.env[descriptor.env] !== undefined);
        const override = stored.get(descriptor.key);

        return {
            key: descriptor.key,
            label: descriptor.label,
            help: descriptor.help ?? null,
            type: descriptor.type,
            value: await getSetting(descriptor.key),
            // eslint-disable-next-line no-nested-ternary
            source: envLocked ? 'env' : override ? 'database' : 'config',
            // An env-pinned setting cannot be changed from the console; saying
            // so up front beats a write that silently has no effect.
            editable: !envLocked,
            envVar: descriptor.env ?? null,
            updatedAt: override?.updated_at ?? null,
            updatedBy: override?.updated_by ?? null,
        };
    }));

    const credentials = SECRET_ENV_VARS.map(({ key, env, label }) => ({
        key,
        label,
        envVar: env,
        configured: Boolean(process.env[env]),
    }));

    return { settings, credentials };
}
