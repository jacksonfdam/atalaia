import { query, queryOne } from '../db/pool.js';
import { encrypt, decrypt, maskSecret, canEncrypt } from '../crypto.js';
import { getLlmProvider, listLlmProviders } from './llmProviders.js';
import config from '../config.js';
import logger from '../logger.js';

/**
 * Which model explains a vulnerability in plain English, and where it runs.
 *
 * Same precedence as the rest of Atalaia: LLM_PROVIDER in the environment wins,
 * then this table, then config.json. A deployment that pinned the provider in
 * .env keeps behaving exactly as before.
 */

const ENV_KEYS = ['LLM_PROVIDER', 'OPENAI_API_KEY', 'OPENAI_MODEL', 'OLLAMA_URL', 'OLLAMA_MODEL'];

async function readRow() {
    try {
        return await queryOne('SELECT * FROM llm_config WHERE id = 1');
    } catch (err) {
        logger.warn({ err }, 'Failed to read the LLM configuration');
        return null;
    }
}

/** Whether the environment is pinning the provider. */
export function isEnvConfigured() {
    return Boolean(process.env.LLM_PROVIDER);
}

/** Configuration as the environment describes it, in the old variable names. */
function fromEnv() {
    const id = String(process.env.LLM_PROVIDER).toLowerCase();
    const descriptor = getLlmProvider(id);

    if (!descriptor) {
        return { ready: false, reason: `LLM_PROVIDER is "${id}", which is not a provider Atalaia knows`, source: 'env' };
    }

    const apiKey = process.env.OPENAI_API_KEY ?? null;

    return {
        ready: descriptor.requiresKey ? Boolean(apiKey) : true,
        reason: descriptor.requiresKey && !apiKey ? 'OPENAI_API_KEY is not set' : undefined,
        source: 'env',
        provider: descriptor.id,
        api: descriptor.api,
        model: (id === 'ollama' ? process.env.OLLAMA_MODEL : process.env.OPENAI_MODEL) || descriptor.defaultModel,
        baseUrl: (id === 'ollama' ? process.env.OLLAMA_URL : null) || descriptor.baseUrl,
        apiKey,
        kind: descriptor.kind,
    };
}

/**
 * The effective configuration, key included. Only the adapter calls this.
 * @returns {{ ready: boolean, reason?: string, source: 'env'|'database'|'config'|'none',
 *             provider?: string, api?: string, model?: string, baseUrl?: string,
 *             apiKey?: string|null, kind?: string }}
 */
export async function resolveLlmConfig() {
    if (isEnvConfigured()) return fromEnv();

    const row = await readRow();

    if (!row) {
        // config.json may still name a provider from before this table existed.
        const fromConfig = config.llm?.provider;
        const descriptor = fromConfig ? getLlmProvider(fromConfig) : null;

        if (descriptor) {
            return {
                ready: !descriptor.requiresKey,
                reason: descriptor.requiresKey ? 'No API key stored for this provider' : undefined,
                source: 'config',
                provider: descriptor.id,
                api: descriptor.api,
                model: descriptor.defaultModel,
                baseUrl: descriptor.baseUrl,
                apiKey: null,
                kind: descriptor.kind,
            };
        }

        return { ready: false, reason: 'No model configured', source: 'none' };
    }

    const descriptor = getLlmProvider(row.provider);
    if (!descriptor) {
        return { ready: false, reason: `Stored provider "${row.provider}" is no longer supported`, source: 'database' };
    }

    let apiKey = null;
    if (row.api_key_cipher) {
        try {
            apiKey = decrypt(row.api_key_cipher);
        } catch (err) {
            logger.error({ err }, 'Failed to decrypt the LLM API key');
            return {
                ready: false,
                reason: 'Stored key cannot be decrypted — TOKEN_ENCRYPTION_KEY (or API_KEY) changed',
                source: 'database',
                provider: descriptor.id,
            };
        }
    }

    const baseUrl = row.base_url || descriptor.baseUrl;

    const missing = [];
    if (!row.enabled) missing.push('explanations are switched off');
    if (descriptor.requiresKey && !apiKey) missing.push('no API key');
    if (!baseUrl) missing.push('no endpoint URL');

    return {
        ready: missing.length === 0,
        reason: missing.length > 0 ? missing.join(', ') : undefined,
        source: 'database',
        provider: descriptor.id,
        api: descriptor.api,
        model: row.model || descriptor.defaultModel,
        baseUrl,
        apiKey,
        kind: descriptor.kind,
    };
}

/** Everything the console renders. Never the key. */
export async function describeLlmConfig() {
    const row = await readRow();
    const resolved = await resolveLlmConfig();
    const descriptor = getLlmProvider(row?.provider ?? resolved.provider ?? 'ollama');

    return {
        providers: listLlmProviders(),
        config: {
            provider: row?.provider ?? 'ollama',
            model: row?.model ?? null,
            baseUrl: row?.base_url ?? null,
            hasApiKey: Boolean(row?.api_key_cipher),
            apiKeyHint: row?.api_key_hint ?? null,
            enabled: Boolean(row?.enabled),
            updatedAt: row?.updated_at ?? null,
            updatedBy: row?.updated_by ?? null,
        },
        envLocked: isEnvConfigured(),
        envVars: ENV_KEYS,
        status: {
            ready: resolved.ready,
            reason: resolved.reason ?? null,
            source: resolved.source,
            provider: resolved.provider ?? null,
            model: resolved.model ?? null,
            // Worth stating plainly: a hosted model means the description of
            // every vulnerability leaves the network.
            kind: resolved.kind ?? descriptor?.kind ?? null,
        },
    };
}

/**
 * @param {object} input
 * @param {string} input.provider
 * @param {string} [input.model]
 * @param {string} [input.baseUrl]
 * @param {string} [input.apiKey]  Omit to keep, empty string to clear
 * @param {boolean} [input.enabled]
 * @param {string} [changedBy]
 */
export async function saveLlmConfig(input, changedBy) {
    const descriptor = getLlmProvider(input.provider);
    if (!descriptor) throw new Error(`Unknown LLM provider: ${input.provider}`);

    const current = await readRow();

    let cipher = current?.api_key_cipher ?? null;
    let hint = current?.api_key_hint ?? null;

    if (input.apiKey !== undefined) {
        if (input.apiKey) {
            if (!canEncrypt()) {
                throw new Error(
                    'Cannot store the key: set TOKEN_ENCRYPTION_KEY (or API_KEY) so it can be encrypted at rest'
                );
            }
            cipher = encrypt(input.apiKey);
            hint = maskSecret(input.apiKey);
        } else {
            cipher = null;
            hint = null;
        }
    }

    // A key belongs to one provider: keeping OpenAI's while switching to Groq
    // would authenticate against the wrong service.
    if (current && current.provider !== descriptor.id && input.apiKey === undefined) {
        cipher = null;
        hint = null;
    }

    await query(
        `INSERT INTO llm_config
            (id, provider, model, base_url, api_key_cipher, api_key_hint, enabled, updated_at, updated_by)
         VALUES
            (1, @provider, @model, @baseUrl, @cipher, @hint, @enabled, now(), @changedBy)
         ON CONFLICT (id) DO UPDATE SET
            provider = excluded.provider,
            model = excluded.model,
            base_url = excluded.base_url,
            api_key_cipher = excluded.api_key_cipher,
            api_key_hint = excluded.api_key_hint,
            enabled = excluded.enabled,
            updated_at = excluded.updated_at,
            updated_by = excluded.updated_by`,
        {
            provider: descriptor.id,
            model: input.model || descriptor.defaultModel || null,
            baseUrl: input.baseUrl || descriptor.baseUrl || null,
            cipher,
            hint,
            enabled: input.enabled === undefined ? Boolean(current?.enabled) : Boolean(input.enabled),
            changedBy: changedBy ?? null,
        }
    );

    logger.info({ provider: descriptor.id, changedBy }, 'LLM configuration saved');
    return await describeLlmConfig();
}
