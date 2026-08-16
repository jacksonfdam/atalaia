/**
 * The console's half of a session: a cookie carrying an opaque token, and the
 * header that says a request came from the console's own JavaScript.
 *
 * These live in the root test suite so `pnpm test` covers both services; the
 * module under test is plain Node with no React or Vite involvement.
 */
import { describe, test, expect } from '@jest/globals';

const {
    COOKIE_NAME,
    CSRF_HEADER,
    cookieOptions,
    parseCookies,
    readToken,
    requireCsrfHeader,
    requireSession,
} = await import('../../../ui/server/session.js');

function reply() {
    const res = {
        statusCode: null,
        body: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(payload) {
            this.body = payload;
            return this;
        },
    };
    return res;
}

describe('the session cookie', () => {
    test('is HttpOnly, same-site and scoped to the whole console', () => {
        const options = cookieOptions(1000);

        expect(options.httpOnly).toBe(true);
        expect(options.sameSite).toBe('lax');
        expect(options.path).toBe('/');
        expect(options.maxAge).toBe(1000);
    });

    test('is a session cookie when no lifetime is known', () => {
        expect(cookieOptions()).not.toHaveProperty('maxAge');
    });

    test('carries whatever token the API issued, opaque to this service', () => {
        const req = { cookies: { [COOKIE_NAME]: 'an-opaque-token' } };
        expect(readToken(req)).toBe('an-opaque-token');
    });

    test('reads as absent when it is missing or empty', () => {
        expect(readToken({ cookies: {} })).toBeNull();
        expect(readToken({ cookies: { [COOKIE_NAME]: '' } })).toBeNull();
        expect(readToken({})).toBeNull();
    });
});

describe('requireSession', () => {
    test('lets a request with a cookie through', () => {
        let called = false;
        requireSession({ cookies: { [COOKIE_NAME]: 'token' } }, reply(), () => {
            called = true;
        });
        expect(called).toBe(true);
    });

    test('rejects one without', () => {
        const res = reply();
        requireSession({ cookies: {} }, res, () => {
            throw new Error('should not continue');
        });
        expect(res.statusCode).toBe(401);
    });
});

describe('the console request header', () => {
    test('is not asked of a read', () => {
        let called = false;
        requireCsrfHeader({ method: 'GET', headers: {} }, reply(), () => {
            called = true;
        });
        expect(called).toBe(true);
    });

    test('is required on anything that changes state', () => {
        const res = reply();
        requireCsrfHeader({ method: 'POST', headers: {} }, res, () => {
            throw new Error('should not continue');
        });

        expect(res.statusCode).toBe(403);
    });

    test('is satisfied by the header the console sends', () => {
        let called = false;
        requireCsrfHeader({ method: 'POST', headers: { [CSRF_HEADER]: '1' } }, reply(), () => {
            called = true;
        });
        expect(called).toBe(true);
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
        const cookies = parse(`other=1; ${COOKIE_NAME}=abcdef; trailing=2`);
        expect(cookies[COOKIE_NAME]).toBe('abcdef');
    });

    test('decodes percent-encoded values', () => {
        expect(parse('x=a%20b').x).toBe('a b');
    });
});
