import axios from 'axios';
import logger from '../logger.js';
import { normalizeBaseUrl, withReachableHost } from './endpoint.js';

const TIMEOUT_MS = parseInt(process.env.LLM_TIMEOUT_MS, 10) || 30_000;

export class OllamaProvider {
    constructor(url = 'http://localhost:11434', model = 'llama3.1') {
        // Whatever was pasted, this class talks to /api/generate off the base.
        this.url = normalizeBaseUrl(url) || 'http://localhost:11434';
        this.model = model;
    }

    async complete(prompt) {
        const start = Date.now();

        try {
            const data = await withReachableHost(this.url, async base => {
                const response = await axios.post(
                    `${base}/api/generate`,
                    { model: this.model, prompt, stream: false },
                    { timeout: TIMEOUT_MS }
                );
                return response.data;
            });

            const result = (data.response ?? '').trim();

            if (!result) {
                // A model that answers with nothing is a different problem from
                // one that cannot be reached, and the operator needs to know
                // which — a base model does exactly this.
                logger.warn(
                    { provider: 'ollama', model: this.model },
                    'Ollama answered with an empty completion'
                );
                return null;
            }

            logger.info(
                { provider: 'ollama', model: this.model, durationMs: Date.now() - start },
                'LLM completion succeeded'
            );
            return result;
        } catch (error) {
            logger.error(
                { provider: 'ollama', model: this.model, err: error.message, durationMs: Date.now() - start },
                'LLM request failed'
            );

            // Thrown, not swallowed: returning null here made a 404 and a
            // refused connection indistinguishable from a model with nothing to
            // say, and the console reported all three as "returned nothing".
            throw new Error(describeOllamaFailure(error, this.url, this.model));
        }
    }
}

/** Say which of the three things went wrong, and what to do about it. */
function describeOllamaFailure(error, url, model) {
    const status = error.response?.status;
    const code = error.code ?? error.cause?.code;

    if (status === 404) {
        const detail = error.response?.data?.error ?? '';

        // Ollama answers 404 both for an unknown route and an unpulled model.
        return /model/i.test(detail)
            ? `Ollama does not have "${model}" — pull it with: ollama pull ${model}`
            : `${url}/api/generate answered 404. Set the endpoint to the base URL (http://localhost:11434), not a /v1/chat path.`;
    }

    if (code === 'ECONNREFUSED') {
        return `Nothing is listening on ${url}. Start Ollama, and from a container use host.docker.internal instead of localhost.`;
    }

    if (code === 'ECONNABORTED' || /timeout/i.test(error.message)) {
        return `${model} did not answer within ${TIMEOUT_MS / 1000}s. A larger model on a cold start can exceed it; LLM_TIMEOUT_MS raises the limit.`;
    }

    return error.message;
}
