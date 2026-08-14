import { describe, test, expect } from '@jest/globals';
import {
    normalizeBaseUrl,
    normalizeVersionedBaseUrl,
    isLoopback,
    viaContainerHost,
    withReachableHost,
} from '#app/infrastructure/llm/endpoint.js';

/**
 * The two things that made a working Ollama configuration stop working: a URL
 * with the wrong path, and a loopback host inside a container.
 */

describe('normalizeBaseUrl', () => {
    test('leaves a base URL alone', () => {
        expect(normalizeBaseUrl('http://localhost:11434')).toBe('http://localhost:11434');
    });

    test.each([
        'http://localhost:11434/v1/chat/completions',
        'http://localhost:11434/v1/chat',
        'http://localhost:11434/v1',
        'http://localhost:11434/api/generate',
        'http://localhost:11434/',
    ])('strips %s back to the base', url => {
        // Every hosted provider wants the /v1/chat/completions form, so that is
        // what people paste. Appending /api/generate to it gives a 404.
        expect(normalizeBaseUrl(url)).toBe('http://localhost:11434');
    });

    test('does not eat a path that is part of the deployment', () => {
        expect(normalizeBaseUrl('https://gateway.example.com/ollama')).toBe(
            'https://gateway.example.com/ollama'
        );
    });
});

describe('normalizeVersionedBaseUrl', () => {
    test.each([
        // Every provider descriptor, unchanged by normalisation.
        ['https://api.openai.com/v1', 'https://api.openai.com/v1'],
        ['http://localhost:1234/v1', 'http://localhost:1234/v1'],
        ['https://api.anthropic.com/v1', 'https://api.anthropic.com/v1'],
        ['https://openrouter.ai/api/v1', 'https://openrouter.ai/api/v1'],
        ['https://api.groq.com/openai/v1', 'https://api.groq.com/openai/v1'],
        // Gemini versions the path differently, and appending /v1 would break it.
        [
            'https://generativelanguage.googleapis.com/v1beta/openai',
            'https://generativelanguage.googleapis.com/v1beta/openai',
        ],
    ])('leaves %s alone', (input, expected) => {
        expect(normalizeVersionedBaseUrl(input)).toBe(expected);
    });

    test.each([
        'http://localhost:1234/v1/chat/completions',
        'http://localhost:1234/v1/chat',
        'http://localhost:1234/v1/',
    ])('strips the chat path off %s', url => {
        expect(normalizeVersionedBaseUrl(url)).toBe('http://localhost:1234/v1');
    });

    test('adds the version a bare host is missing', () => {
        expect(normalizeVersionedBaseUrl('http://localhost:1234')).toBe('http://localhost:1234/v1');
    });

    test('strips the messages path Anthropic uses', () => {
        expect(normalizeVersionedBaseUrl('https://api.anthropic.com/v1/messages')).toBe(
            'https://api.anthropic.com/v1'
        );
    });

    test('leaves an empty URL empty, so the caller can fall back', () => {
        expect(normalizeVersionedBaseUrl('')).toBe('');
    });
});

describe('reaching the host from a container', () => {
    test('recognises the addresses that mean "this machine"', () => {
        expect(isLoopback('http://localhost:11434')).toBe(true);
        expect(isLoopback('http://127.0.0.1:11434')).toBe(true);
        expect(isLoopback('https://api.openai.com')).toBe(false);
    });

    test('swaps the host without touching the rest', () => {
        expect(viaContainerHost('http://localhost:11434')).toBe('http://host.docker.internal:11434');
    });

    test('retries a refused loopback through the gateway', async () => {
        const tried = [];

        const result = await withReachableHost('http://localhost:11434', async url => {
            tried.push(url);
            if (url.includes('localhost')) {
                throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
            }
            return 'answered';
        });

        expect(result).toBe('answered');
        expect(tried).toEqual(['http://localhost:11434', 'http://host.docker.internal:11434']);
    });

    test('does not retry a remote host that refused', async () => {
        const attempt = async () => {
            throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
        };

        await expect(withReachableHost('https://api.openai.com', attempt)).rejects.toThrow('ECONNREFUSED');
    });

    test('does not retry a failure that is not a refused connection', async () => {
        let calls = 0;

        const attempt = async () => {
            calls += 1;
            throw Object.assign(new Error('Request failed with status code 404'), {
                response: { status: 404 },
            });
        };

        await expect(withReachableHost('http://localhost:11434', attempt)).rejects.toThrow('404');
        expect(calls).toBe(1);
    });
});
