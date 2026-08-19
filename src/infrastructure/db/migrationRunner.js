import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../logger.js';
import { getPool } from './pool.js';

const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = path.resolve(path.dirname(__filename), '..', '..', '..');
const MIGRATIONS_DIR = path.join(PROJECT_ROOT, 'db/migrations');

/**
 * An arbitrary but fixed namespace for the lock, so it can never collide with an
 * advisory lock some other application took on the same database.
 */
const LOCK_NAMESPACE = 8_010_071;

/**
 * The lock is per schema, not per database.
 *
 * What it has to prevent is two processes migrating *the same* schema at once:
 * the API container and the worker container both migrate on boot and would
 * otherwise race. Two processes migrating *different* schemas do not conflict at
 * all, and a single key made them queue anyway.
 *
 * That over-serialisation is what made the test suite intermittent. Every
 * integration suite migrates its own throwaway schema, twice — once through
 * setUpSchema and again through initializeDatabase — so eleven Jest workers
 * queued twenty-two acquisitions on one key, each holding it for a full replay
 * of every migration file. Measured mid-run, six suites were waiting on it at
 * once. Whichever suite ended up last paid for all the others, and on a busy
 * machine that is what pushed a test past its timeout.
 *
 * A signed 32-bit hash, because that is what pg_advisory_lock's second key is.
 *
 * @param {string} schema
 * @returns {number}
 */
function lockKeyFor(schema) {
    let hash = 0;

    for (let index = 0; index < schema.length; index += 1) {
        hash = (Math.imul(hash, 31) + schema.charCodeAt(index)) | 0;
    }

    return hash;
}

/**
 * Apply every pending migration, in filename order, each one in its own
 * transaction — Postgres does transactional DDL, so a migration that throws
 * halfway leaves no half-built schema behind.
 */
export async function runMigrations() {
    if (!fs.existsSync(MIGRATIONS_DIR)) {
        logger.warn({ dir: MIGRATIONS_DIR }, 'Migrations directory not found');
        return;
    }

    const files = fs
        .readdirSync(MIGRATIONS_DIR)
        .filter(f => f.endsWith('.sql'))
        .sort(); // alphabetical: 001_, 002_, …

    // One dedicated client: an advisory lock belongs to the session that took
    // it, so it has to be taken, used and released on the same connection.
    const client = await getPool().connect();

    // The schema the connection resolves to, which is what the migrations are
    // about to be applied into. Read before the try, because the unlock in the
    // finally needs the same key.
    const { rows: current } = await client.query('SELECT current_schema() AS schema');
    const key = lockKeyFor(current[0]?.schema ?? 'public');

    try {
        await client.query('SELECT pg_advisory_lock($1, $2)', [LOCK_NAMESPACE, key]);

        await client.query(`
            CREATE TABLE IF NOT EXISTS _migrations (
                id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                name        text UNIQUE NOT NULL,
                applied_at  timestamptz NOT NULL DEFAULT now()
            )
        `);

        const { rows } = await client.query('SELECT name FROM _migrations');
        const applied = new Set(rows.map(row => row.name));

        let count = 0;

        for (const file of files) {
            if (applied.has(file)) continue;

            const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8');

            try {
                await client.query('BEGIN');
                await client.query(sql);
                await client.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
                await client.query('COMMIT');
                count++;
                logger.info({ migration: file }, 'Applied migration');
            } catch (err) {
                await client.query('ROLLBACK');
                logger.error({ migration: file, err }, 'Migration failed');
                throw err; // Stop here — never skip past a broken migration
            }
        }

        if (count > 0) logger.info({ count }, 'Migrations completed');
    } finally {
        await client.query('SELECT pg_advisory_unlock($1, $2)', [LOCK_NAMESPACE, key]).catch(() => {
            // Releasing on a dead connection is moot: the lock dies with the
            // session anyway.
        });
        client.release();
    }
}
