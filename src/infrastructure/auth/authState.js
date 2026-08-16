import { query, queryOne } from '../db/pool.js';
import logger from '../logger.js';

/**
 * Two facts about this installation that outlive a restart: whether the first
 * account has been created, and which relying party id the existing credentials
 * were registered under.
 *
 * They live in the existing `settings` table rather than a second key/value
 * table. They are not operator-writable, so they are deliberately absent from
 * WRITABLE_SETTINGS in settings.js and read straight from the row here.
 */

const BOOTSTRAPPED = 'auth.bootstrapped';
const RP_ID = 'auth.rpId';

async function read(key) {
    const row = await queryOne('SELECT value FROM settings WHERE key = @key', { key });
    if (!row) return undefined;

    try {
        return JSON.parse(row.value);
    } catch {
        return undefined;
    }
}

async function write(key, value) {
    await query(
        `INSERT INTO settings (key, value, updated_at, updated_by)
         VALUES (@key, @value, now(), 'auth')
         ON CONFLICT (key) DO UPDATE SET
            value = excluded.value,
            updated_at = excluded.updated_at,
            updated_by = excluded.updated_by`,
        { key, value: JSON.stringify(value) }
    );
}

/** Whether the first administrator has been created. */
export async function isBootstrapped() {
    return (await read(BOOTSTRAPPED)) === true;
}

export async function markBootstrapped() {
    await write(BOOTSTRAPPED, true);
    logger.info('First administrator created; the setup password no longer grants access');
}

/**
 * Compare the configured relying party id against the one in force when
 * credentials were registered.
 *
 * Changing it does not migrate anything — it orphans every passkey in
 * existence, and the only symptom is that nobody can sign in. Worth a loud line
 * in the log rather than a support ticket.
 *
 * @param {string} rpID
 * @returns {Promise<{changed: boolean, previous?: string}>}
 */
export async function reconcileRpId(rpID) {
    const previous = await read(RP_ID);

    if (previous === undefined) {
        await write(RP_ID, rpID);
        return { changed: false };
    }

    if (previous === rpID) return { changed: false };

    logger.error(
        { previous, configured: rpID },
        'WEBAUTHN_RP_ID has changed. Every passkey registered under the previous value is ' +
            'now unusable and each user will have to enroll again, or come back in with a ' +
            'recovery code. Restore the previous value if this was not deliberate.'
    );

    return { changed: true, previous };
}

/** Accept the new relying party id, after somebody has confirmed they meant it. */
export async function acceptRpId(rpID) {
    await write(RP_ID, rpID);
}
