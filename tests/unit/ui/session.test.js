/**
 * Session cookie tests for the console's BFF.
 *
 * These live in the root test suite so `npm test` covers both services; the
 * module under test is plain Node with no React or Vite involvement.
 */
import { describe, test, expect, beforeAll } from '@jest/globals';

process.env.UI_SESSION_SECRET = 'test-secret-not-a-real-key';

const { issue, verify, COOKIE_NAME, parseCookies } = await import('../../../ui/server/session.js');

describe('session cookies', () => {
    test('a freshly issued cookie verifies', () => {
        expect(verify(issue())).toBe(true);
    });

    test('an absent cookie does not verify', () => {
        expect(verify(undefined)).toBe(false);
        expect(verify('')).toBe(false);
    });

    test('a malformed cookie does not verify', () => {
        expect(verify('garbage')).toBe(false);
        expect(verify('two.parts')).toBe(false);
        expect(verify('a.b.c.d')).toBe(false);
    });

    test('a tampered payload does not verify', () => {
        const cookie = issue();
        const [id, expiry, signature] = cookie.split('.');

        // Extend the expiry while keeping the original signature.
        const forged = `${id}.${Number(expiry) + 86_400_000}.${signature}`;
        expect(verify(forged)).toBe(false);
    });

    test('a tampered signature does not verify', () => {
        const [id, expiry] = issue().split('.');
        expect(verify(`${id}.${expiry}.deadbeef`)).toBe(false);
    });

    test('an expired cookie does not verify', () => {
        expect(verify(issue(-1000))).toBe(false);
    });

    test('a cookie signed with a different secret does not verify', () => {
        const foreign = issue();
        const original = process.env.UI_SESSION_SECRET;

        process.env.UI_SESSION_SECRET = 'a-completely-different-secret';
        expect(verify(foreign)).toBe(false);

        process.env.UI_SESSION_SECRET = original;
        expect(verify(foreign)).toBe(true);
    });

    test('two cookies issued back to back differ', () => {
        expect(issue()).not.toBe(issue());
    });

    test('refuses to issue when no secret is configured', () => {
        const original = process.env.UI_SESSION_SECRET;
        delete process.env.UI_SESSION_SECRET;

        expect(() => issue()).toThrow(/UI_SESSION_SECRET/);

        process.env.UI_SESSION_SECRET = original;
    });
});

describe('cookie parsing', () => {
    function parse(header) {
        const req = { headers: header === undefined ? {} : { cookie: header } };
        parseCookies(req, {}, () => {});
        return req.cookies;
    }

    test('handles a missing header', () => {
        expect(parse(undefined)).toEqual({});
    });

    test('reads the session cookie among others', () => {
        const cookies = parse(`other=1; ${COOKIE_NAME}=abc.def.ghi; trailing=2`);
        expect(cookies[COOKIE_NAME]).toBe('abc.def.ghi');
    });

    test('decodes percent-encoded values', () => {
        expect(parse('x=a%20b').x).toBe('a b');
    });
});
