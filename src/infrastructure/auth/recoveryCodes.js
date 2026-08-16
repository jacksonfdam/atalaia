import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { query, queryAll, queryOne } from '../db/pool.js';

/**
 * The way back in when every passkey is gone.
 *
 * A passkey lives inside a credential provider the user does not control — an
 * iCloud account, a password manager, a security key in a drawer. Any of those
 * can be lost in a way the user cannot undo, and without these codes the only
 * remaining answer is "reinstall the service".
 *
 * Hashed with scrypt from node:crypto rather than argon2id. The codes are 120
 * bits of randomness, not passwords somebody chose: there is no dictionary to
 * run and no human pattern to exploit, so the memory-hardness argument that
 * makes argon2id worth a native dependency does not apply here. What matters is
 * that a database dump does not hand over usable codes, and a salted KDF does
 * that.
 */

const scrypt = promisify(crypto.scrypt);

const CODE_COUNT = 10;
/** 120 bits: divisible by five, so it lands on exactly 24 base32 characters. */
const CODE_BYTES = 15;

/**
 * Crockford's alphabet: no I, L, O or U, so nothing reads as a digit and
 * nothing spells anything. These get written down and typed back by hand.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

const SCRYPT = { N: 16_384, r: 8, p: 1, keylen: 32, maxmem: 64 * 1024 * 1024 };

function encode(bytes) {
    let bits = 0;
    let value = 0;
    let out = '';

    for (const byte of bytes) {
        value = (value << 8) | byte;
        bits += 8;

        while (bits >= 5) {
            out += ALPHABET[(value >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }

    return out;
}

/** Grouped for transcription; the groups are not part of the value. */
function format(raw) {
    return raw.match(/.{1,6}/g).join('-');
}

/**
 * Accept what a human typed: any case, any grouping, and the substitutions
 * Crockford's alphabet exists to forgive.
 */
export function normalizeCode(input) {
    return String(input ?? '')
        .toUpperCase()
        .replace(/[IL]/g, '1')
        .replace(/O/g, '0')
        .replace(/[^0-9A-Z]/g, '');
}

async function hashCode(code, salt = crypto.randomBytes(16)) {
    const derived = await scrypt(code, salt, SCRYPT.keylen, SCRYPT);
    return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('hex')}$${derived.toString('hex')}`;
}

async function matches(code, stored) {
    const parts = String(stored).split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

    const [, N, r, p, saltHex, hashHex] = parts;
    const expected = Buffer.from(hashHex, 'hex');

    const derived = await scrypt(code, Buffer.from(saltHex, 'hex'), expected.length, {
        N: Number(N),
        r: Number(r),
        p: Number(p),
        maxmem: SCRYPT.maxmem,
    });

    return crypto.timingSafeEqual(derived, expected);
}

/**
 * Replace this user's codes with ten new ones.
 *
 * Replace, not append: a set half of which was printed last year is a set
 * nobody can reason about. Issuing new codes invalidates the old ones, and the
 * plaintext is returned here and never again.
 *
 * @param {string} userId
 * @param {import('pg').PoolClient} [client]
 * @returns {Promise<string[]>} the codes, in the form the user should keep them
 */
export async function issueRecoveryCodes(userId, client = null) {
    const codes = Array.from({ length: CODE_COUNT }, () => encode(crypto.randomBytes(CODE_BYTES)));
    const hashes = await Promise.all(codes.map(code => hashCode(code)));

    await query('DELETE FROM recovery_codes WHERE user_id = @userId', { userId }, client);

    for (const codeHash of hashes) {
        await query(
            'INSERT INTO recovery_codes (user_id, code_hash) VALUES (@userId, @codeHash)',
            { userId, codeHash },
            client
        );
    }

    return codes.map(format);
}

/**
 * Spend a code.
 *
 * Scoped to one user rather than searched across the whole table, which is why
 * the recovery form asks for a username as well as a code: an unscoped lookup
 * would mean running scrypt against every unused code in the installation for
 * each attempt, and that is a denial of service anyone can trigger.
 *
 * The username is not a second factor and is not treated as one — the answer to
 * a wrong username and a wrong code is the same answer.
 *
 * @param {string} userId
 * @param {string} input  what the user typed
 * @returns {Promise<boolean>}
 */
export async function consumeRecoveryCode(userId, input) {
    const code = normalizeCode(input);
    if (code.length === 0) return false;

    const rows = await queryAll(
        'SELECT id, code_hash FROM recovery_codes WHERE user_id = @userId AND used_at IS NULL',
        { userId }
    );

    for (const row of rows) {
        if (!(await matches(code, row.code_hash))) continue;

        // Marked used in the same statement that claims it, so two requests
        // with the same code cannot both succeed.
        const claimed = await queryOne(
            'UPDATE recovery_codes SET used_at = now() WHERE id = @id AND used_at IS NULL RETURNING id',
            { id: row.id }
        );

        return Boolean(claimed);
    }

    return false;
}

/** How many are left, for the warning the console shows. */
export async function countUnusedRecoveryCodes(userId) {
    const row = await queryOne(
        'SELECT count(*)::int AS n FROM recovery_codes WHERE user_id = @userId AND used_at IS NULL',
        { userId }
    );
    return row?.n ?? 0;
}
