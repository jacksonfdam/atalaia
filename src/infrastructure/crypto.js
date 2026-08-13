import crypto from 'crypto';

/**
 * Symmetric encryption for the few secrets Atalaia has to store rather than read
 * from the environment — currently the per-organization GitHub tokens.
 *
 * A token in the database is a credential to somebody else's source code, so it
 * is never stored in the clear and never leaves through the API. Callers get
 * `hasToken` and a masked hint instead.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const PREFIX = 'v1';

/**
 * The key must be stable across restarts, or every stored token becomes
 * unreadable. TOKEN_ENCRYPTION_KEY is the explicit choice; API_KEY is accepted
 * as a fallback so a single-service deployment works without a second secret.
 */
function resolveKey() {
    const material = process.env.TOKEN_ENCRYPTION_KEY || process.env.API_KEY;

    if (!material) {
        throw new Error(
            'Cannot encrypt secrets: set TOKEN_ENCRYPTION_KEY (or API_KEY) before storing tokens'
        );
    }

    // A fixed salt keeps derivation deterministic; the secrecy lives in the key
    // material, not in the salt.
    return crypto.scryptSync(material, 'atalaia.token.v1', 32);
}

/** @returns {boolean} Whether a key is available at all. */
export function canEncrypt() {
    return Boolean(process.env.TOKEN_ENCRYPTION_KEY || process.env.API_KEY);
}

/**
 * @param {string} plaintext
 * @returns {string} `v1:<iv>:<tag>:<ciphertext>`, all base64
 */
export function encrypt(plaintext) {
    const iv = crypto.randomBytes(IV_BYTES);
    const cipher = crypto.createCipheriv(ALGORITHM, resolveKey(), iv);

    const encrypted = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);

    return [
        PREFIX,
        iv.toString('base64'),
        cipher.getAuthTag().toString('base64'),
        encrypted.toString('base64'),
    ].join(':');
}

/**
 * @param {string|null} payload Value produced by encrypt()
 * @returns {string|null}
 */
export function decrypt(payload) {
    if (!payload) return null;

    const [prefix, iv, tag, data] = String(payload).split(':');
    if (prefix !== PREFIX || !iv || !tag || !data) {
        throw new Error('Stored secret is not in the expected format');
    }

    const decipher = crypto.createDecipheriv(ALGORITHM, resolveKey(), Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));

    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString(
        'utf8'
    );
}

/**
 * Last four characters, for an operator to recognise which token is stored
 * without the value being readable.
 * @param {string} secret
 */
export function maskSecret(secret) {
    const text = String(secret ?? '');
    if (text.length <= 4) return '••••';
    return `••••${text.slice(-4)}`;
}
