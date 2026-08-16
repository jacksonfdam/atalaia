/**
 * The tunnel registry chooses a provider; it does not open anything here.
 */
import { test, expect, describe, beforeEach, afterEach } from '@jest/globals';
import {
    tunnels,
    PROVIDER_NAMES,
    describeTunnels,
    resolveTunnelProvider,
} from '#app/infrastructure/tunnels/tunnelRegistry.js';

const ENV_KEYS = ['TUNNEL_PROVIDER', 'NGROK_AUTH_TOKEN', 'NGROK_AUTHTOKEN'];
const saved = {};

beforeEach(() => {
    for (const key of ENV_KEYS) {
        saved[key] = process.env[key];
        delete process.env[key];
    }
});

afterEach(() => {
    for (const key of ENV_KEYS) {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
    }
});

describe('the registry', () => {
    test('every provider fulfils the same contract', () => {
        for (const provider of tunnels) {
            expect(typeof provider.name).toBe('string');
            expect(typeof provider.label).toBe('string');
            expect(typeof provider.isConfigured).toBe('function');
            expect(typeof provider.start).toBe('function');
        }
    });

    test('names are unique', () => {
        expect(new Set(PROVIDER_NAMES).size).toBe(PROVIDER_NAMES.length);
    });

    test('describes each provider without starting it', () => {
        const described = describeTunnels();
        expect(described.map(p => p.name)).toEqual(PROVIDER_NAMES);
        // Cloudflare needs nothing, so it is always configured.
        expect(described.find(p => p.name === 'cloudflared').configured).toBe(true);
    });
});

describe('choosing a provider', () => {
    test('none is an answer, not a failure', () => {
        process.env.TUNNEL_PROVIDER = 'none';
        const { provider, reason } = resolveTunnelProvider();
        expect(provider).toBeNull();
        expect(reason).toContain('none');
    });

    test('an unknown name says which ones exist', () => {
        process.env.TUNNEL_PROVIDER = 'zeppelin';
        const { provider, reason } = resolveTunnelProvider();
        expect(provider).toBeNull();
        expect(reason).toContain('cloudflared');
    });

    test('a named provider is used even when unconfigured', () => {
        process.env.TUNNEL_PROVIDER = 'ngrok';
        expect(resolveTunnelProvider().provider.name).toBe('ngrok');
    });

    test('auto takes ngrok when it has a token', () => {
        process.env.NGROK_AUTH_TOKEN = 'token';
        expect(resolveTunnelProvider().provider.name).toBe('ngrok');
    });

    test('auto falls back to the one that needs no account', () => {
        expect(resolveTunnelProvider().provider.name).toBe('cloudflared');
    });
});
