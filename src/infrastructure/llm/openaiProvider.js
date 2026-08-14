import axios from 'axios';
import logger from '../logger.js';
import { normalizeVersionedBaseUrl, withReachableHost } from './endpoint.js';

const TIMEOUT_MS = parseInt(process.env.LLM_TIMEOUT_MS, 10) || 20_000;

/**
 * The OpenAI chat-completions shape, which is also what LM Studio, vLLM,
 * OpenRouter, Groq and most gateways speak — so the base URL is a parameter
 * rather than a constant.
 */
export class OpenAIProvider {
    constructor(apiKey, model = 'gpt-4o-mini', baseUrl = 'https://api.openai.com') {
        this.apiKey = apiKey;
        this.model = model;
        // Whatever was pasted — bare host, base with /v1, or the full chat path —
        // this class talks to /chat/completions off a versioned base.
        this.baseUrl = normalizeVersionedBaseUrl(baseUrl) || 'https://api.openai.com/v1';
    }

    async complete(prompt) {
        const start = Date.now();

        try {
            const data = await withReachableHost(this.baseUrl, async base => {
                const response = await axios.post(
                    `${base}/chat/completions`,
                    {
                        model: this.model,
                        messages: [{ role: 'user', content: prompt }],
                        temperature: 0.3,
                        max_tokens: 150,
                    },
                    {
                        // A local server needs no key, and sending an empty bearer
                        // makes some of them reject the request outright.
                        headers: this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {},
                        timeout: TIMEOUT_MS,
                    }
                );
                return response.data;
            });

            const result = (data?.choices?.[0]?.message?.content ?? '').trim();

            if (!result) {
                logger.warn(
                    { provider: 'openai', model: this.model },
                    'Model answered with an empty completion'
                );
                return null;
            }

            logger.info(
                { provider: 'openai', model: this.model, durationMs: Date.now() - start },
                'LLM completion succeeded'
            );
            return result;
        } catch (error) {
            logger.error(
                { provider: 'openai', model: this.model, err: error.message, durationMs: Date.now() - start },
                'LLM request failed'
            );

            // Thrown, not swallowed: a rejected key and an unreachable host are
            // different problems, and returning null made them both read as
            // "the model had nothing to say".
            throw new Error(describeFailure(error, this.baseUrl, this.model));
        }
    }
}

/** Say which of the usual four things went wrong, and what to do about it. */
function describeFailure(error, url, model) {
    const status = error.response?.status;
    const code = error.code ?? error.cause?.code;
    const detail = error.response?.data?.error?.message ?? error.response?.data?.error ?? '';

    if (status === 401 || status === 403) {
        return `${url} rejected the key${detail ? `: ${detail}` : '.'}`;
    }

    if (status === 404) {
        return detail
            ? `${url} does not have "${model}": ${detail}`
            : `${url}/chat/completions answered 404. Check the endpoint URL and the model name.`;
    }

    if (status === 429) {
        return `${url} is rate limiting this key. Try again shortly.`;
    }

    if (code === 'ECONNREFUSED') {
        return `Nothing is listening on ${url}. Start the server, and from a container use host.docker.internal instead of localhost.`;
    }

    if (code === 'ECONNABORTED' || /timeout/i.test(error.message)) {
        return `${model} did not answer within ${TIMEOUT_MS / 1000}s. LLM_TIMEOUT_MS raises the limit.`;
    }

    return detail ? `${error.message}: ${detail}` : error.message;
}
