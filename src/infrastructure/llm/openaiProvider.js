import axios from 'axios';
import logger from '../logger.js';

/**
 * The OpenAI chat-completions shape, which is also what LM Studio, vLLM,
 * OpenRouter, Groq and most gateways speak — so the base URL is a parameter
 * rather than a constant.
 */
export class OpenAIProvider {
    constructor(apiKey, model = 'gpt-4o-mini', baseUrl = 'https://api.openai.com/v1') {
        this.apiKey = apiKey;
        this.model = model;
        this.baseUrl = String(baseUrl).replace(/\/$/, '');
    }

    async complete(prompt) {
        const start = Date.now();
        try {
            const response = await axios.post(
                `${this.baseUrl}/chat/completions`,
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
                    timeout: 20000,
                }
            );

            const result = response.data.choices[0].message.content.trim();
            logger.info({ provider: 'openai', model: this.model, durationMs: Date.now() - start }, 'LLM completion succeeded');
            return result;
        } catch (error) {
            logger.error({ provider: 'openai', err: error, durationMs: Date.now() - start }, 'LLM request failed');
            return null;
        }
    }
}
