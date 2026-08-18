import pg from 'pg';
import logger from '../logger.js';

/**
 * The one Postgres pool for this process.
 *
 * Opened lazily rather than at import time: the tests point DATABASE_URL at a
 * throwaway schema after their own imports have run, and reading it at import
 * would pin every suite to whatever was set first.
 */

let pool = null;

/**
 * Postgres counts timestamps and bigints differently from JavaScript.
 *
 *   int8 (1700) — node-postgres returns it as a string to avoid losing
 *   precision past 2^53. Every count() in this codebase is a small number
 *   being rendered or compared, so a string would surface as "12" in the
 *   console and break `total > 0`. Parsed here, once.
 *
 *   timestamptz (1184) and timestamp (1114) — returned as Date objects, which
 *   JSON.stringify renders as an ISO string with a Z. The API contract is
 *   already ISO strings and the console parses them as such, so they are left
 *   as text and normalised in one place instead of guessing per column.
 */
pg.types.setTypeParser(pg.types.builtins.INT8, value => (value === null ? null : Number(value)));
pg.types.setTypeParser(pg.types.builtins.TIMESTAMPTZ, value => value);
pg.types.setTypeParser(pg.types.builtins.TIMESTAMP, value => value);

/**
 * A timestamp column, back as a `Date`.
 *
 * The parsers above hand these over as the text Postgres wrote, which is
 * `2026-08-10 12:00:00+00` — a space instead of the T, and an offset with no
 * minutes. `new Date()` rejects both: the offset especially, since the spec
 * wants ±hh:mm and V8 does not guess. Anything doing date arithmetic on a
 * column read from here needs this rather than its own `replace`.
 *
 * @param {string|Date|null|undefined} value
 * @returns {Date|null}
 */
export function toDate(value) {
    if (value === null || value === undefined || value === '') return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;

    const iso = String(value).replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00');
    const parsed = new Date(iso);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function connectionString() {
    const url = process.env.DATABASE_URL;
    if (!url) {
        throw new Error(
            'DATABASE_URL is not set. Point it at a Postgres — the session connection, usually port 5432, not a transaction pooler on 6543.'
        );
    }
    return url;
}

export function getPool() {
    if (pool) return pool;

    pool = new pg.Pool({
        connectionString: connectionString(),
        max: Number(process.env.DATABASE_POOL_MAX) || 10,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 10_000,
    });

    // An idle client erroring out (a database restart, a dropped connection)
    // reaches the pool, not any one query. Unhandled, it takes the process down.
    pool.on('error', err => logger.error({ err }, 'Idle Postgres client errored'));

    return pool;
}

/**
 * pg binds positionally ($1); this codebase reads better with names. Translate
 * once, here, reusing a placeholder when the same name appears twice.
 *
 * String literals are skipped, because `@` is an ordinary character inside one:
 * `WHERE email = 'sec@acme.com'` would otherwise be read as a parameter called
 * `acme` and throw. Doubled quotes ('') are the SQL escape and stay inside the
 * literal.
 */
function toPositional(sql, params) {
    const values = [];
    const seen = new Map();
    const out = [];

    let i = 0;
    let inLiteral = false;

    while (i < sql.length) {
        const char = sql[i];

        if (inLiteral) {
            out.push(char);
            if (char === "'") {
                // '' is an escaped quote, not the end of the literal.
                if (sql[i + 1] === "'") {
                    out.push("'");
                    i += 2;
                    continue;
                }
                inLiteral = false;
            }
            i++;
            continue;
        }

        if (char === "'") {
            inLiteral = true;
            out.push(char);
            i++;
            continue;
        }

        if (char === '@') {
            const match = /^@([a-zA-Z_][a-zA-Z0-9_]*)/.exec(sql.slice(i));
            if (match) {
                const name = match[1];
                if (!(name in params)) {
                    throw new Error(`Missing bind parameter @${name}`);
                }
                if (!seen.has(name)) {
                    values.push(params[name]);
                    seen.set(name, values.length);
                }
                out.push(`$${seen.get(name)}`);
                i += match[0].length;
                continue;
            }
        }

        out.push(char);
        i++;
    }

    return { text: out.join(''), values };
}

/**
 * Run a statement.
 *
 * @param {string} sql
 * @param {object|Array} [params] Named (@name) or positional ($1) bindings
 * @param {import('pg').PoolClient} [client] Runs on this client instead of the pool
 * @returns {Promise<import('pg').QueryResult>}
 */
export async function query(sql, params = {}, client = null) {
    const runner = client ?? getPool();

    if (Array.isArray(params)) return runner.query(sql, params);

    const { text, values } = toPositional(sql, params);
    return runner.query(text, values);
}

/** The first row, or null. */
export async function queryOne(sql, params = {}, client = null) {
    const { rows } = await query(sql, params, client);
    return rows[0] ?? null;
}

/** Every row. */
export async function queryAll(sql, params = {}, client = null) {
    const { rows } = await query(sql, params, client);
    return rows;
}

/**
 * Run `fn` inside a transaction on a dedicated client, rolling back on throw.
 *
 * @param {(client: import('pg').PoolClient) => Promise<T>} fn
 * @returns {Promise<T>}
 * @template T
 */
export async function withTransaction(fn) {
    const client = await getPool().connect();

    try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
    } catch (err) {
        await client.query('ROLLBACK').catch(rollbackErr => {
            // The original error is the one worth throwing; a failed rollback
            // usually means the connection is already gone.
            logger.error({ err: rollbackErr }, 'Rollback failed');
        });
        throw err;
    } finally {
        client.release();
    }
}

/** Close the pool. Used by the tests and by a clean shutdown. */
export async function closePool() {
    if (!pool) return;
    await pool.end();
    pool = null;
}
