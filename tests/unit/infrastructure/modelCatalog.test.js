import { jest } from '@jest/globals';

/**
 * What the console is told when it asks a model server what it has.
 *
 * The two shapes differ (Ollama's /api/tags, everyone else's /models), and the
 * failure cases matter as much as the listing: the answer is read by someone
 * filling in a form, so "nothing is listening" has to come back as data rather
 * than as an exception.
 */

const get = jest.fn();
jest.unstable_mockModule('axios', () => ({ default: { get } }));

const { listModels, SUGGESTED_OLLAMA_MODEL } = await import('#app/infrastructure/llm/modelCatalog.js');

beforeEach(() => get.mockReset());

function refused() {
    const error = new Error('connect ECONNREFUSED');
    error.code = 'ECONNREFUSED';
    return error;
}

describe('Ollama', () => {
    test('lists the installed models, sorted, from /api/tags', async () => {
        get.mockResolvedValue({ data: { models: [{ name: 'qwen2.5:7b' }, { name: 'llama3.1:latest' }] } });

        const result = await listModels({ api: 'ollama', baseUrl: 'http://localhost:11434' });

        expect(get.mock.calls[0][0]).toBe('http://localhost:11434/api/tags');
        expect(result).toEqual({ reachable: true, models: ['llama3.1:latest', 'qwen2.5:7b'] });
    });

    test('a pasted /v1/chat path still reaches /api/tags off the base', async () => {
        get.mockResolvedValue({ data: { models: [] } });

        await listModels({ api: 'ollama', baseUrl: 'http://localhost:11434/v1/chat/completions' });

        expect(get.mock.calls[0][0]).toBe('http://localhost:11434/api/tags');
    });

    test('an empty server says what to pull', async () => {
        get.mockResolvedValue({ data: { models: [] } });

        const result = await listModels({ api: 'ollama', baseUrl: 'http://localhost:11434' });

        expect(result.reachable).toBe(true);
        expect(result.models).toEqual([]);
        expect(result.hint).toContain(`ollama pull ${SUGGESTED_OLLAMA_MODEL}`);
    });

    test('a server that is not running is reported, not thrown', async () => {
        // Loopback refusal retries through the container host, and that refuses too.
        get.mockRejectedValue(refused());

        const result = await listModels({ api: 'ollama', baseUrl: 'http://localhost:11434' });

        expect(result.reachable).toBe(false);
        expect(result.models).toEqual([]);
        expect(result.error).toContain('Nothing is listening');
        expect(result.hint).toContain('host.docker.internal');
    });
});

describe('OpenAI-compatible servers', () => {
    test('reads ids from /models off the versioned base', async () => {
        get.mockResolvedValue({ data: { data: [{ id: 'b-model' }, { id: 'a-model' }, { id: 'a-model' }] } });

        const result = await listModels({ api: 'openai', baseUrl: 'http://localhost:1234/v1' });

        expect(get.mock.calls[0][0]).toBe('http://localhost:1234/v1/models');
        expect(result.models).toEqual(['a-model', 'b-model']);
    });

    test('sends the key as a bearer token, and no header when there is none', async () => {
        get.mockResolvedValue({ data: { data: [] } });

        await listModels({ api: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-test' });
        await listModels({ api: 'openai', baseUrl: 'http://localhost:1234/v1', apiKey: null });

        expect(get.mock.calls[0][1].headers).toEqual({ Authorization: 'Bearer sk-test' });
        expect(get.mock.calls[1][1].headers).toEqual({});
    });

    test('a rejected key is named as such', async () => {
        const error = new Error('Request failed with status code 401');
        error.response = { status: 401 };
        get.mockRejectedValue(error);

        const result = await listModels({ api: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: 'bad' });

        expect(result.reachable).toBe(false);
        expect(result.error).toContain('rejected the key');
    });
});

describe('Anthropic', () => {
    test('is not asked, and says where its names are listed', async () => {
        const result = await listModels({ api: 'anthropic', baseUrl: 'https://api.anthropic.com/v1' });

        expect(get).not.toHaveBeenCalled();
        expect(result.reachable).toBe(true);
        expect(result.models).toEqual([]);
    });
});
