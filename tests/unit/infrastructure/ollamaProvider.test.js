import { jest } from '@jest/globals';

/**
 * What is actually sent to Ollama.
 *
 * Both of these were found by measuring a real model rather than by reading the
 * code, which is why they are pinned here: the request body and the timeout are
 * the difference between a model that works and one that reads as broken.
 */

const post = jest.fn();
jest.unstable_mockModule('axios', () => ({ default: { post } }));

const { OllamaProvider } = await import('#app/infrastructure/llm/ollamaProvider.js');

beforeEach(() => {
    post.mockReset();
    post.mockResolvedValue({ data: { response: 'It is bad.' } });
});

/** The body of the single request the provider made. */
function sentBody() {
    return post.mock.calls[0][1];
}

/** The axios config of that request. */
function sentConfig() {
    return post.mock.calls[0][2];
}

describe('the request body', () => {
    test('asks for the answer, not the reasoning', async () => {
        await new OllamaProvider('http://localhost:11434', 'gemma4:12b').complete('Explain it.');

        // Without this, a thinking model spends its whole budget reasoning
        // about a three-sentence paragraph: 57.7s against 6.2s, same answer.
        expect(sentBody().think).toBe(false);
    });

    test('still carries the prompt, the model and stream: false', async () => {
        await new OllamaProvider('http://localhost:11434', 'gemma4:12b').complete('Explain it.');

        expect(sentBody()).toMatchObject({
            model: 'gemma4:12b',
            prompt: 'Explain it.',
            stream: false,
        });
    });

    test('posts to /api/generate off the base URL', async () => {
        await new OllamaProvider('http://localhost:11434/v1/chat', 'gemma4:12b').complete('x');

        expect(post.mock.calls[0][0]).toBe('http://localhost:11434/api/generate');
    });
});

describe('the timeout', () => {
    // Ollama unloads an idle model, and the cycle runs hourly, so nearly every
    // call is a cold start. A 12B writing a 300-word guide measured 30.3s cold,
    // which the old 30s default cut off.
    test('leaves room for a model that has to load first', async () => {
        await new OllamaProvider('http://localhost:11434', 'gemma4:12b').complete('x');

        expect(sentConfig().timeout).toBeGreaterThanOrEqual(60_000);
    });
});

describe('what comes back', () => {
    test('an answer is returned trimmed', async () => {
        post.mockResolvedValue({ data: { response: '  It is bad.  ' } });

        const answer = await new OllamaProvider().complete('x');
        expect(answer).toBe('It is bad.');
    });

    test('an empty completion is null, not an empty string', async () => {
        post.mockResolvedValue({ data: { response: '   ' } });

        expect(await new OllamaProvider().complete('x')).toBeNull();
    });

    // A 404 and a refused connection used to be indistinguishable from a model
    // with nothing to say, and the console reported all three the same way.
    test('a transport failure throws rather than looking like silence', async () => {
        post.mockRejectedValue(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }));

        await expect(new OllamaProvider().complete('x')).rejects.toThrow();
    });
});
