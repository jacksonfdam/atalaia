/**
 * What a failed completion says.
 *
 * A provider used to return null for every failure, so "the model returned
 * nothing" was the console's answer to a wrong endpoint, a missing model, a
 * rejected key and a stopped server alike. Each one now names itself.
 */
import { describe, test, expect, jest, beforeEach } from '@jest/globals';

const post = jest.fn();
jest.unstable_mockModule('axios', () => ({ default: { post } }));

const { OllamaProvider } = await import('#app/infrastructure/llm/ollamaProvider.js');
const { OpenAIProvider } = await import('#app/infrastructure/llm/openaiProvider.js');

/** An axios rejection, as the provider sees it. */
function httpError(status, data) {
    return Object.assign(new Error(`Request failed with status code ${status}`), {
        response: { status, data },
    });
}

function refused() {
    return Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:11434'), { code: 'ECONNREFUSED' });
}

beforeEach(() => post.mockReset());

describe('Ollama', () => {
    test('posts to /api/generate off the base, whatever the endpoint field held', async () => {
        post.mockResolvedValue({ data: { response: 'yes' } });

        // The endpoint that caused the original report.
        const answer = await new OllamaProvider('http://localhost:11434/v1/chat', 'llama3.1').complete('hi');

        expect(answer).toBe('yes');
        expect(post.mock.calls[0][0]).toBe('http://localhost:11434/api/generate');
    });

    test('a 404 on the route points at the endpoint, not the model', async () => {
        post.mockRejectedValue(httpError(404, '404 page not found'));

        await expect(new OllamaProvider('http://localhost:11434', 'llama3.1').complete('hi')).rejects.toThrow(
            /Set the endpoint to the base URL/
        );
    });

    test('a 404 on the model says how to pull it', async () => {
        post.mockRejectedValue(httpError(404, { error: 'model "mistral" not found, try pulling it first' }));

        await expect(new OllamaProvider('http://localhost:11434', 'mistral').complete('hi')).rejects.toThrow(
            'Ollama does not have "mistral" — pull it with: ollama pull mistral'
        );
    });

    test('a refused loopback is retried through the container host gateway', async () => {
        post.mockRejectedValueOnce(refused()).mockResolvedValueOnce({ data: { response: 'yes' } });

        const answer = await new OllamaProvider('http://localhost:11434', 'llama3.1').complete('hi');

        expect(answer).toBe('yes');
        expect(post.mock.calls[1][0]).toBe('http://host.docker.internal:11434/api/generate');
    });

    test('a server that is not running says so, once the gateway fails too', async () => {
        post.mockRejectedValue(refused());

        await expect(new OllamaProvider('http://localhost:11434', 'llama3.1').complete('hi')).rejects.toThrow(
            /Nothing is listening/
        );
    });

    test('an empty completion is null, not an error — the model was reached', async () => {
        post.mockResolvedValue({ data: { response: '   ' } });

        await expect(new OllamaProvider('http://localhost:11434', 'x').complete('hi')).resolves.toBeNull();
    });
});

describe('OpenAI-compatible', () => {
    test('posts to /chat/completions off the versioned base', async () => {
        post.mockResolvedValue({ data: { choices: [{ message: { content: 'yes' } }] } });

        await new OpenAIProvider('key', 'gpt-4o-mini', 'https://api.openai.com/v1').complete('hi');

        expect(post.mock.calls[0][0]).toBe('https://api.openai.com/v1/chat/completions');
    });

    test('sends no Authorization header when there is no key', async () => {
        post.mockResolvedValue({ data: { choices: [{ message: { content: 'yes' } }] } });

        // Some local servers reject an empty bearer outright.
        await new OpenAIProvider('', 'local-model', 'http://localhost:1234/v1').complete('hi');

        expect(post.mock.calls[0][2].headers).toEqual({});
    });

    test('a rejected key says so', async () => {
        post.mockRejectedValue(httpError(401, { error: { message: 'Incorrect API key provided' } }));

        await expect(new OpenAIProvider('bad', 'gpt-4o-mini').complete('hi')).rejects.toThrow(
            'https://api.openai.com/v1 rejected the key: Incorrect API key provided'
        );
    });
});
