import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../logger.js';

const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = path.resolve(path.dirname(__filename), '..', '..', '..');
const MIGRATIONS_DIR = path.join(PROJECT_ROOT, 'db/migrations');

/**
 * Run all pending SQL migrations against the given database.
 * Tracks applied migrations in a `_migrations` table.
 * Migration files are executed in alphabetical order (001_, 002_, etc.).
 *
 * @param {import('better-sqlite3').Database} db
 */
export function runMigrations(db) {
    // Create tracking table if it doesn't exist
    db.exec(`
        CREATE TABLE IF NOT EXISTS _migrations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            applied_at TEXT DEFAULT (datetime('now'))
        )
    `);

    // Get already-applied migrations
    const applied = new Set(
        db.prepare('SELECT name FROM _migrations').all().map(r => r.name)
    );

    // Find all .sql files in migrations directory
    if (!fs.existsSync(MIGRATIONS_DIR)) {
        logger.warn({ dir: MIGRATIONS_DIR }, 'Migrations directory not found');
        return;
    }

    const files = fs.readdirSync(MIGRATIONS_DIR)
        .filter(f => f.endsWith('.sql'))
        .sort(); // alphabetical order: 001_, 002_, ...

    let appliedCount = 0;

    for (const file of files) {
        if (applied.has(file)) continue;

        const filePath = path.join(MIGRATIONS_DIR, file);
        const sql = fs.readFileSync(filePath, 'utf-8');

        try {
            db.exec(sql);
            db.prepare('INSERT INTO _migrations (name) VALUES (?)').run(file);
            appliedCount++;
            logger.info({ migration: file }, 'Applied migration');
        } catch (error) {
            logger.error({ migration: file, err: error }, 'Migration failed');
            throw error; // Stop on failure — don't skip broken migrations
        }
    }

    if (appliedCount > 0) {
        logger.info({ count: appliedCount }, 'Migrations completed');
    }
}
