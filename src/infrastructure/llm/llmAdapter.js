import { readFileSync } from 'fs';
import path from 'path';
import logger from '../logger.js';
import { OpenAIProvider } from './openaiProvider.js';
import { OllamaProvider } from './ollamaProvider.js';
import { AnthropicProvider } from './anthropicProvider.js';
import { resolveLlmConfig } from './llmConfig.js';

class NoOpProvider {
    async complete() {
        return null;
    }
}

/**
 * Build the client for whatever is configured — environment, console, or
 * nothing at all.
 *
 * Resolved per call rather than once at startup: the console can change the
 * provider while the service runs, and an explanation is not worth a restart.
 */
export function createLLMAdapter() {
    const config = resolveLlmConfig();

    if (!config.ready) {
        logger.debug({ reason: config.reason }, 'No LLM configured, explanations disabled');
        return new NoOpProvider();
    }

    logger.info(
        { provider: config.provider, model: config.model, source: config.source },
        'Using LLM provider'
    );

    if (config.api === 'anthropic') {
        return new AnthropicProvider({ apiKey: config.apiKey, model: config.model, baseUrl: config.baseUrl });
    }
    if (config.api === 'ollama') {
        return new OllamaProvider(config.baseUrl, config.model);
    }

    return new OpenAIProvider(config.apiKey, config.model, config.baseUrl);
}

/**
 * Ask the configured model for one short answer, so an operator can see whether
 * the thing works before an alert depends on it.
 *
 * @returns {Promise<{ ok: boolean, provider?: string, model?: string, sample?: string, error?: string }>}
 */
export async function testLLM() {
    const config = resolveLlmConfig();
    if (!config.ready) return { ok: false, error: config.reason ?? 'No model configured' };

    const started = Date.now();
    const answer = await createLLMAdapter().complete(
        'Reply with one short sentence confirming you can summarise security advisories.'
    );

    if (!answer) {
        return {
            ok: false,
            provider: config.provider,
            model: config.model,
            error: 'The model returned nothing — check the endpoint, the key and the model name.',
        };
    }

    return {
        ok: true,
        provider: config.provider,
        model: config.model,
        durationMs: Date.now() - started,
        sample: answer.slice(0, 200),
    };
}

/**
 * Render a prompt template by replacing {{variable}} placeholders.
 * @param {string} templateName - Filename in prompts/ directory
 * @param {object} variables - Key-value pairs to substitute
 * @returns {string}
 */
export function renderPrompt(templateName, variables) {
    const templatePath = path.resolve('src/infrastructure/llm/prompts', templateName);
    let template = readFileSync(templatePath, 'utf-8');

    for (const [key, value] of Object.entries(variables)) {
        template = template.replaceAll(`{{${key}}}`, String(value ?? 'N/A'));
    }

    return template;
}
