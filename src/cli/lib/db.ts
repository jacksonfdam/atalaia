import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
// Walk up from dist/cli/lib/db.js (or src/cli/lib/db.ts under tsx) to the project root.
// Both layouts put this file three directories below the repo root.
const PROJECT_ROOT = path.resolve(path.dirname(__filename), '..', '..', '..');

export function resolveDbPath(): string {
  if (process.env.DB_PATH) return path.resolve(process.env.DB_PATH);
  return path.join(PROJECT_ROOT, 'data', 'atalaia.db');
}

function assertDbExists(dbPath: string): void {
  if (!existsSync(dbPath)) {
    throw new Error(
      `Atalaia database not found at ${dbPath}. ` +
        `Start the server once (\`npm start\`) to initialize it, or pass --db <path>.`
    );
  }
}

export function openReadonly(): Database.Database {
  const dbPath = resolveDbPath();
  assertDbExists(dbPath);
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  db.pragma('busy_timeout = 5000');
  return db;
}

export function openWritable(): Database.Database {
  const dbPath = resolveDbPath();
  assertDbExists(dbPath);
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  return db;
}
