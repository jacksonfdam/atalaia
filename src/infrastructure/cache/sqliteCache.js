import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DB_PATH = process.env.DB_PATH || path.resolve('data/atalaia.db');

let db;

export function initializeDatabase() {
    const dbDir = path.dirname(DB_PATH);
    if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
    }

    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');

    const migrationPath = path.resolve('db/migrations/001_initial.sql');
    const migration = fs.readFileSync(migrationPath, 'utf-8');
    db.exec(migration);
    
    console.log('[Cache] SQLite database initialized and migrations applied.');
}

export function getDb() {
    if (!db) {
        initializeDatabase();
    }
    return db;
}

export function has(cveId) {
    const stmt = getDb().prepare('SELECT 1 FROM vulnerabilities WHERE cve_id = ?');
    return !!stmt.get(cveId);
}

export function add(vuln) {
    const stmt = getDb().prepare(`
        INSERT INTO vulnerabilities (
            cve_id, title, description, severity, cvss_score, 
            exploited, source, source_url, affected_technologies, 
            first_seen_at, last_seen_at
        ) VALUES (
            @cveId, @title, @description, @severity, @cvssScore, 
            @exploited, @source, @sourceUrl, @affectedTechnologies, 
            datetime('now'), datetime('now')
        )
        ON CONFLICT(cve_id) DO UPDATE SET
            last_seen_at = datetime('now'),
            source = excluded.source,
            source_url = excluded.source_url
    `);

    try {
        stmt.run({
            cveId: vuln.cveId,
            title: vuln.title,
            description: vuln.description,
            severity: vuln.severity,
            cvssScore: vuln.cvssScore,
            exploited: vuln.exploited ? 1 : 0,
            source: vuln.source || 'unknown', // Default if missing
            sourceUrl: vuln.link,
            affectedTechnologies: JSON.stringify(vuln.affectedTechnologies || [])
        });
        console.log(`[Cache] Added/Updated ${vuln.cveId} in database.`);
    } catch (error) {
        console.error(`[Cache] Failed to add ${vuln.cveId}:`, error);
    }
}

export function getAll() {
     const stmt = getDb().prepare('SELECT * FROM vulnerabilities');
     return stmt.all();
}
