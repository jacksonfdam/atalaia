import axios from 'axios';
import logger from '../logger.js';

const VERSION = '2023-06-01';

/**
 * Anthropic's Messages API: same idea as chat completions, different envelope —
 * the key travels in x-api-key, and the answer is a content array.
 */
export class AnthropicProvider {
    constructor({ apiKey, model, baseUrl = 'https://api.anthropic.com/v1', timeoutMs = 20_000 }) {
        this.apiKey = apiKey;
        this.model = model;
        this.baseUrl = baseUrl.replace(/\/$/, '');
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
                { provider: 'anthropic', err: error.message, durationMs: Date.now() - start },
                'LLM request failed'
            );
            return null;
        }
    }
}
