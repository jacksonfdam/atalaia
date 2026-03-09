import axios from 'axios';
import logger from '../logger.js';

export class OllamaProvider {
    constructor(url = 'http://localhost:11434', model = 'llama2') {
        this.url = url;
        this.model = model;
    }

    async complete(prompt) {
        const start = Date.now();
        try {
            const response = await axios.post(
                `${this.url}/api/generate`,
                { model: this.model, prompt, stream: false },
                { timeout: 30000 }
            );

            const result = response.data.response.trim();
            logger.info({ provider: 'ollama', model: this.model, durationMs: Date.now() - start }, 'LLM completion succeeded');
            return result;
        } catch (error) {
            logger.error({ provider: 'ollama', err: error, durationMs: Date.now() - start }, 'LLM request failed');
            return null;
        }
    }
}
