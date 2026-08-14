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
export async function createLLMAdapter() {
    const config = await resolveLlmConfig();

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
    const config = await resolveLlmConfig();
    if (!config.ready) return { ok: false, error: config.reason ?? 'No model configured' };

    const started = Date.now();
    const adapter = await createLLMAdapter();

    let answer;
    try {
        answer = await adapter.complete(
            'Reply with one short sentence confirming you can summarise security advisories.'
        );
    } catch (error) {
        // The provider knows what went wrong — a 404 on the path, a refused
        // connection, a model that was never pulled. Saying "returned nothing"
        // for all of them sent people checking the wrong thing.
        return { ok: false, provider: config.provider, model: config.model, error: error.message };
    }

    if (!answer) {
        return {
            ok: false,
            provider: config.provider,
            model: config.model,
            error: baseModelWarning(config.model) ?? 'The model answered with nothing at all.',
        };
    }

    return {
        ok: true,
        provider: config.provider,
        model: config.model,
        durationMs: Date.now() - started,
        sample: answer.slice(0, 200),
        // A base model does answer — with a continuation of the prompt rather
        // than a reply. The sample above shows it, and this says why.
        warning: baseModelWarning(config.model),
    };
}

/**
 * A base model is not an assistant.
 *
 * `qwen2.5-coder:1.5b-base` and friends continue text rather than answering it,
 * so an explanation prompt comes back as rambling or empty. The name is the only
 * signal available before the output is read, and it is a reliable one.
 */
function baseModelWarning(model) {
    if (!/[-:.]base$/i.test(String(model ?? ''))) return null;

    return `"${model}" is a base model: it continues text rather than answering it, so explanations will read as nonsense. Use an instruct or chat variant.`;
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
