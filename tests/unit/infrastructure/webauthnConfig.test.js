/**
 * The relying party id and the origin allow-list.
 *
 * Every case here is one the browser would also catch — but it would catch it
 * in front of somebody trying to sign in, with a message they cannot act on.
 */
import { test, expect, describe, beforeEach, afterEach } from '@jest/globals';
import { webauthnConfig, checkWebauthnConfig } from '#app/infrastructure/auth/webauthnConfig.js';

const KEYS = [
    'WEBAUTHN_RP_ID',
    'WEBAUTHN_RP_NAME',
    'WEBAUTHN_ORIGINS',
    'WEBAUTHN_REQUIRE_UV',
    'SESSION_TTL_HOURS',
    'CHALLENGE_TTL_SECONDS',
];

let saved;

beforeEach(() => {
    saved = Object.fromEntries(KEYS.map(key => [key, process.env[key]]));
    for (const key of KEYS) delete process.env[key];
});

afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
});

describe('defaults', () => {
    test('are the development console, so a fresh checkout runs', () => {
        const config = webauthnConfig();

        expect(config.rpID).toBe('localhost');
        expect(config.origins).toEqual(['http://localhost:3001']);
        expect(config.sessionTtlHours).toBe(720);
        expect(config.challengeTtlSeconds).toBe(120);
        expect(config.requireUserVerification).toBe(false);
    });
});

describe('a relying party id', () => {
    test('is a bare domain', () => {
        process.env.WEBAUTHN_RP_ID = 'atalaia.example.com';
        process.env.WEBAUTHN_ORIGINS = 'https://atalaia.example.com';
        expect(webauthnConfig().rpID).toBe('atalaia.example.com');
    });

    test('is not a URL', () => {
        process.env.WEBAUTHN_RP_ID = 'https://atalaia.example.com';
        expect(checkWebauthnConfig().error).toContain('no scheme');
    });

    test('carries no port', () => {
        process.env.WEBAUTHN_RP_ID = 'atalaia.example.com:3001';
        expect(checkWebauthnConfig().error).toContain('no port');
    });
});

describe('origins', () => {
    test('may be several, comma separated', () => {
        process.env.WEBAUTHN_RP_ID = 'example.com';
        process.env.WEBAUTHN_ORIGINS = 'https://example.com, https://console.example.com';

        expect(webauthnConfig().origins).toEqual([
            'https://example.com',
            'https://console.example.com',
        ]);
    });

    test('must sit under the relying party id', () => {
        process.env.WEBAUTHN_RP_ID = 'example.com';
        process.env.WEBAUTHN_ORIGINS = 'https://atalaia.other.com';

        expect(checkWebauthnConfig().error).toContain('not under');
    });

    test('are https, except on loopback', () => {
        process.env.WEBAUTHN_RP_ID = 'example.com';
        process.env.WEBAUTHN_ORIGINS = 'http://example.com';
        expect(checkWebauthnConfig().error).toContain('https');

        process.env.WEBAUTHN_RP_ID = 'localhost';
        process.env.WEBAUTHN_ORIGINS = 'http://localhost:3001';
        expect(checkWebauthnConfig().ok).toBe(true);
    });

    test('are scheme, host and port — nothing else', () => {
        process.env.WEBAUTHN_RP_ID = 'example.com';
        process.env.WEBAUTHN_ORIGINS = 'https://example.com/console';

        expect(checkWebauthnConfig().error).toContain('path');
    });

    test('reject something that is not a URL at all', () => {
        process.env.WEBAUTHN_ORIGINS = 'localhost:3001';
        expect(checkWebauthnConfig().ok).toBe(false);
    });
});

describe('lifetimes', () => {
    test('are read from the environment', () => {
        process.env.SESSION_TTL_HOURS = '24';
        process.env.CHALLENGE_TTL_SECONDS = '60';

        const config = webauthnConfig();
        expect(config.sessionTtlHours).toBe(24);
        expect(config.challengeTtlSeconds).toBe(60);
    });

    test('refuse zero, negatives and nonsense', () => {
        for (const bad of ['0', '-1', 'soon']) {
            process.env.SESSION_TTL_HOURS = bad;
            expect(checkWebauthnConfig().error).toContain('positive number');
        }
    });
});

describe('user verification', () => {
    test('is opt-in, because a security key without a PIN still beats a shared password', () => {
        expect(webauthnConfig().requireUserVerification).toBe(false);

        process.env.WEBAUTHN_REQUIRE_UV = 'true';
        expect(webauthnConfig().requireUserVerification).toBe(true);
    });
});
