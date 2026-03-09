import axios from 'axios';
import logger from '../logger.js';

export class OpenAIProvider {
    constructor(apiKey, model = 'gpt-4o-mini') {
        this.apiKey = apiKey;
        this.model = model;
    }

    async complete(prompt) {
        const start = Date.now();
        try {
            const response = await axios.post(
                'https://api.openai.com/v1/chat/completions',
                {
                    model: this.model,
                    messages: [{ role: 'user', content: prompt }],
                    temperature: 0.3,
                    max_tokens: 150,
                },
                {
                    headers: { Authorization: `Bearer ${this.apiKey}` },
                    timeout: 15000,
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
