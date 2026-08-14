import axios from 'axios';
import logger from '../logger.js';
import { normalizeVersionedBaseUrl } from './endpoint.js';

const VERSION = '2023-06-01';

/**
 * Anthropic's Messages API: same idea as chat completions, different envelope —
 * the key travels in x-api-key, and the answer is a content array.
 */
export class AnthropicProvider {
    constructor({ apiKey, model, baseUrl = 'https://api.anthropic.com/v1', timeoutMs = 20_000 }) {
        this.apiKey = apiKey;
        this.model = model;
        this.baseUrl = normalizeVersionedBaseUrl(baseUrl) || 'https://api.anthropic.com/v1';
        this.timeoutMs = timeoutMs;
    }

    async complete(prompt) {
        const start = Date.now();

        try {
            const { data } = await axios.post(
                `${this.baseUrl}/messages`,
                {
                    model: this.model,
                    max_tokens: 300,
                    temperature: 0.3,
                    messages: [{ role: 'user', content: prompt }],
                },
                {
                    headers: {
                        'x-api-key': this.apiKey,
                        'anthropic-version': VERSION,
                        'content-type': 'application/json',
                    },
                    timeout: this.timeoutMs,
                }
            );

            const text = (data?.content ?? [])
                .filter(block => block.type === 'text')
                .map(block => block.text)
                .join('')
                .trim();

            logger.info(
                { provider: 'anthropic', model: this.model, durationMs: Date.now() - start },
                'LLM completion succeeded'
            );
            return text || null;
        } catch (error) {
            logger.error(
                { provider: 'anthropic', model: this.model, err: error.message, durationMs: Date.now() - start },
                'LLM request failed'
            );

            // Thrown, not swallowed: a rejected key and an unknown model are
            // different problems, and the console reported both as "the model
            // returned nothing".
            throw new Error(describeFailure(error, this.baseUrl, this.model, this.timeoutMs));
        }
    }
}

/** Say what Anthropic actually answered, and what to do about it. */
function describeFailure(error, url, model, timeoutMs) {
    const status = error.response?.status;
    const code = error.code ?? error.cause?.code;
    const detail = error.response?.data?.error?.message ?? '';

    if (status === 401 || status === 403) return `${url} rejected the key${detail ? `: ${detail}` : '.'}`;
    if (status === 404) return `${url} does not have "${model}"${detail ? `: ${detail}` : '.'}`;
    if (status === 429) return `${url} is rate limiting this key. Try again shortly.`;

    if (code === 'ECONNABORTED' || /timeout/i.test(error.message)) {
        return `${model} did not answer within ${timeoutMs / 1000}s.`;
    }

    return detail ? `${error.message}: ${detail}` : error.message;
}
