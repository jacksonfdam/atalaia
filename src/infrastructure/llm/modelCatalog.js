import axios from 'axios';
import { normalizeBaseUrl, normalizeVersionedBaseUrl, withReachableHost } from './endpoint.js';

/**
 * What a model server says it can run.
 *
 * The console used to ask for a model name as free text, which only fails later,
 * at the first explanation, with "does not have <name>". Asking the server up
 * front turns that into a pick from a list — and, when the list is empty, into a
 * hint at what to download.
 *
 * Nothing here throws for a server that is down or refuses the key: an operator
 * filling in the form is exactly who needs to be told, so the answer carries it.
 */

/** Short: this runs while someone waits at a form, and a dead host should not hang it. */
const TIMEOUT_MS = 5_000;

/** A small instruct model people can pull without a workstation, to suggest when none is installed. */
export const SUGGESTED_OLLAMA_MODEL = 'llama3.1';

/**
 * @typedef {object} ModelListing
 * @property {boolean} reachable
 * @property {string[]} models   Names as the server wants them back, sorted
 * @property {string} [error]    Why the server could not be asked
 * @property {string} [hint]     What to do about an empty or failed listing
 */

/**
 * @param {{ api: 'ollama'|'openai'|'anthropic', baseUrl: string, apiKey?: string|null }} target
 * @returns {Promise<ModelListing>}
 */
export async function listModels({ api, baseUrl, apiKey }) {
    if (api === 'anthropic') {
        return { reachable: true, models: [], hint: 'Anthropic model names are listed in its documentation.' };
    }

    try {
        const models =
            api === 'ollama' ? await listOllama(baseUrl) : await listOpenAICompatible(baseUrl, apiKey);

        const sorted = [...new Set(models)].sort((a, b) => a.localeCompare(b));

        return {
            reachable: true,
            models: sorted,
            ...(sorted.length === 0 ? { hint: emptyHint(api) } : {}),
        };
    } catch (error) {
        return { reachable: false, models: [], error: describe(error, baseUrl), hint: unreachableHint(api) };
    }
}

async function listOllama(baseUrl) {
    const data = await withReachableHost(normalizeBaseUrl(baseUrl), async base => {
        const response = await axios.get(`${base}/api/tags`, { timeout: TIMEOUT_MS });
        return response.data;
    });

    return (data?.models ?? []).map(entry => entry.name ?? entry.model).filter(Boolean);
}

async function listOpenAICompatible(baseUrl, apiKey) {
    const data = await withReachableHost(normalizeVersionedBaseUrl(baseUrl), async base => {
        const response = await axios.get(`${base}/models`, {
            headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
            timeout: TIMEOUT_MS,
        });
        return response.data;
    });

    return (data?.data ?? []).map(entry => entry.id).filter(Boolean);
}

function emptyHint(api) {
    return api === 'ollama'
        ? `Ollama is running but has no models. Download one with: ollama pull ${SUGGESTED_OLLAMA_MODEL}`
        : 'The server answered but lists no models. Load one in it, then refresh.';
}

function unreachableHint(api) {
    return api === 'ollama'
        ? 'Start Ollama, and check the endpoint. From a container, use host.docker.internal rather than localhost.'
        : 'Start the server and check the endpoint. A hosted provider also needs its API key saved first.';
}

function describe(error, baseUrl) {
    const status = error.response?.status;
    const code = error.code ?? error.cause?.code;

    if (status === 401 || status === 403) return `${baseUrl} rejected the key.`;
    if (status === 404) return `${baseUrl} does not list models at the expected path.`;
    if (code === 'ECONNREFUSED') return `Nothing is listening on ${baseUrl}.`;
    if (code === 'ECONNABORTED' || /timeout/i.test(error.message)) return `${baseUrl} did not answer in time.`;

    return error.message;
}
