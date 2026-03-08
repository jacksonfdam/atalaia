import { readFileSync } from 'fs';
import path from 'path';
import logger from '../logger.js';
import { OpenAIProvider } from './openaiProvider.js';
import { OllamaProvider } from './ollamaProvider.js';

class NoOpProvider {
    async complete() {
        return null;
    }
}

/**
 * Create an LLM provider based on environment configuration.
 * Falls back to NoOpProvider if no provider is configured.
 */
export function createLLMAdapter() {
    const provider = process.env.LLM_PROVIDER?.toLowerCase();

    switch (provider) {
        case 'openai':
            logger.info({ provider: 'openai', model: process.env.OPENAI_MODEL || 'gpt-4o-mini' }, 'Using OpenAI LLM provider');
            return new OpenAIProvider(process.env.OPENAI_API_KEY, process.env.OPENAI_MODEL);
        case 'ollama':
            logger.info({ provider: 'ollama', model: process.env.OLLAMA_MODEL || 'llama2' }, 'Using Ollama LLM provider');
            return new OllamaProvider(process.env.OLLAMA_URL, process.env.OLLAMA_MODEL);
        default:
            logger.info('No LLM provider configured, explanations disabled');
            return new NoOpProvider();
    }
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
