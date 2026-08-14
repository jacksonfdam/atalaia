import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../logger.js';
import { getPool } from './pool.js';

const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = path.resolve(path.dirname(__filename), '..', '..', '..');
const MIGRATIONS_DIR = path.join(PROJECT_ROOT, 'db/migrations');

/**
 * An arbitrary but fixed key. Any two processes using the same number
 * serialise against each other, which is the whole point: the API container and
 * the worker container both migrate on boot and would otherwise race.
 */
const LOCK_KEY = 8_010_071;

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

    try {
        await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);

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
        await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {
            // Releasing on a dead connection is moot: the lock dies with the
            // session anyway.
        });
        client.release();
    }
}
