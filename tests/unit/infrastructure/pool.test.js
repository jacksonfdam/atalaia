import { describe, expect, test, jest } from '@jest/globals';

/**
 * The named-parameter translator.
 *
 * It sits under every query in the codebase, and it is the kind of code where a
 * wrong answer is a corrupted statement rather than an obvious crash — so the
 * cases that bit are pinned down here.
 *
 * No database is needed: the translation happens before anything is sent.
 */

// The module opens no connection at import time, so it is safe to load.
const { query, toDate } = await import('#app/infrastructure/db/pool.js');

/** Capture what would have been sent, without a server. */
function fakeClient() {
    const calls = [];
    return {
        calls,
        query: (text, values) => {
            calls.push({ text, values });
            return Promise.resolve({ rows: [], rowCount: 0 });
        },
    };
}

describe('named parameters', () => {
    test('are translated to positional bindings in order', async () => {
        const client = fakeClient();
        await query('SELECT * FROM t WHERE a = @a AND b = @b', { a: 1, b: 2 }, client);

        expect(client.calls[0].text).toBe('SELECT * FROM t WHERE a = $1 AND b = $2');
        expect(client.calls[0].values).toEqual([1, 2]);
    });

    test('reuse one placeholder when the same name appears twice', async () => {
        const client = fakeClient();
        await query('SELECT @x, @x, @y', { x: 'once', y: 'twice' }, client);

        expect(client.calls[0].text).toBe('SELECT $1, $1, $2');
        expect(client.calls[0].values).toEqual(['once', 'twice']);
    });

    test('an @ inside a string literal is left alone', async () => {
        const client = fakeClient();

        // This threw "Missing bind parameter @acme" before: the email domain in a
        // literal was being read as a parameter name.
        await query("DELETE FROM owners WHERE email = 'sec@acme.com'", {}, client);

        expect(client.calls[0].text).toBe("DELETE FROM owners WHERE email = 'sec@acme.com'");
        expect(client.calls[0].values).toEqual([]);
    });

    test('parameters outside a literal still bind when one is present', async () => {
        const client = fakeClient();
        await query("SELECT * FROM t WHERE tag = 'a@b' AND id = @id", { id: 7 }, client);

        expect(client.calls[0].text).toBe("SELECT * FROM t WHERE tag = 'a@b' AND id = $1");
        expect(client.calls[0].values).toEqual([7]);
    });

    test("a doubled quote does not end the literal", async () => {
        const client = fakeClient();
        await query("SELECT 'it''s @not a param', @real", { real: 1 }, client);

        expect(client.calls[0].text).toBe("SELECT 'it''s @not a param', $1");
        expect(client.calls[0].values).toEqual([1]);
    });

    test('a missing parameter is refused rather than sent as text', async () => {
        const client = fakeClient();

        await expect(query('SELECT @nope', {}, client)).rejects.toThrow('Missing bind parameter @nope');
        expect(client.calls).toHaveLength(0);
    });

    test('an array is passed through as positional bindings untouched', async () => {
        const client = fakeClient();
        await query('SELECT * FROM t WHERE id = $1', [42], client);

        expect(client.calls[0].text).toBe('SELECT * FROM t WHERE id = $1');
        expect(client.calls[0].values).toEqual([42]);
    });
});

/**
 * Timestamp columns are handed over as text on purpose, and the text is not
 * something `new Date()` accepts. Every one of these bit somewhere.
 */
describe('toDate', () => {
    test('parses what Postgres actually writes', () => {
        expect(toDate('2026-08-10 12:00:00+00').toISOString()).toBe('2026-08-10T12:00:00.000Z');
    });

    test('keeps the fractional seconds', () => {
        expect(toDate('2026-08-18 19:16:39.258882+00').toISOString()).toBe('2026-08-18T19:16:39.258Z');
    });

    test('honours a non-UTC offset', () => {
        expect(toDate('2026-08-10 14:00:00+02').toISOString()).toBe('2026-08-10T12:00:00.000Z');
    });

    test('accepts an offset that already has its minutes', () => {
        expect(toDate('2026-08-10 12:00:00+00:00').toISOString()).toBe('2026-08-10T12:00:00.000Z');
    });

    test('accepts a plain ISO string', () => {
        expect(toDate('2026-08-10T12:00:00Z').toISOString()).toBe('2026-08-10T12:00:00.000Z');
    });

    test('passes a Date through', () => {
        const date = new Date('2026-08-10T12:00:00Z');
        expect(toDate(date)).toBe(date);
    });

    test('is null for nothing, rather than the epoch or now', () => {
        expect(toDate(null)).toBeNull();
        expect(toDate(undefined)).toBeNull();
        expect(toDate('')).toBeNull();
        expect(toDate('not a timestamp')).toBeNull();
    });
});
