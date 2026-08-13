import { describe, test, expect, beforeAll } from '@jest/globals';

process.env.TOKEN_ENCRYPTION_KEY = 'unit-test-encryption-key';

const { encrypt, decrypt, maskSecret, canEncrypt } = await import('#app/infrastructure/crypto.js');

describe('crypto', () => {
    test('round-trips a value', () => {
        expect(decrypt(encrypt('ghp_token_value'))).toBe('ghp_token_value');
    });

    test('never leaves the plaintext in the payload', () => {
        expect(encrypt('ghp_token_value')).not.toContain('ghp_token_value');
    });

    test('produces a different payload every time', () => {
        // A fresh IV per call: identical tokens must not look identical at rest.
        expect(encrypt('same')).not.toBe(encrypt('same'));
    });

    test('refuses a tampered payload', () => {
        const payload = encrypt('ghp_token_value');
        const [prefix, iv, tag, data] = payload.split(':');
        const flipped = data.startsWith('A') ? `B${data.slice(1)}` : `A${data.slice(1)}`;

        expect(() => decrypt([prefix, iv, tag, flipped].join(':'))).toThrow();
    });

    test('rejects a payload that is not in the expected format', () => {
        expect(() => decrypt('not-a-payload')).toThrow(/expected format/);
    });

    test('decrypting nothing yields null', () => {
        expect(decrypt(null)).toBeNull();
    });

    test('masks all but the last four characters', () => {
        expect(maskSecret('ghp_abcdefgh1234')).toBe('••••1234');
        expect(maskSecret('abc')).toBe('••••');
    });

    test('reports whether a key is available', () => {
        expect(canEncrypt()).toBe(true);
    });
});
