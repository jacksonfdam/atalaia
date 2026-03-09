import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import logger from '../logger.js';

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
    
    logger.info('SQLite database initialized and migrations applied');
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
        logger.info({ cveId: vuln.cveId }, 'Added/Updated vulnerability in database');
    } catch (error) {
        logger.error({ cveId: vuln.cveId, err: error }, 'Failed to add vulnerability to database');
    }
}

export function get(cveId) {
    const stmt = getDb().prepare('SELECT * FROM vulnerabilities WHERE cve_id = ?');
    const row = stmt.get(cveId);
    if (!row) return null;
    row.affectedTechnologies = row.affected_technologies ? JSON.parse(row.affected_technologies) : [];
    return row;
}

export function update(cveId, updates) {
    const fields = [];
    const values = {};
    values.cveId = cveId;

    if (updates.status !== undefined) {
        fields.push('status = @status');
        values.status = updates.status;
    }
    if (updates.statusChangedBy !== undefined) {
        fields.push('status_changed_by = @statusChangedBy');
        values.statusChangedBy = updates.statusChangedBy;
    }
    if (updates.statusChangedAt !== undefined) {
        fields.push('status_changed_at = @statusChangedAt');
        values.statusChangedAt = updates.statusChangedAt;
    }
    if (updates.resolvedAt !== undefined) {
        fields.push('resolved_at = @resolvedAt');
        values.resolvedAt = updates.resolvedAt;
    }
    if (updates.clientExplanation !== undefined) {
        fields.push('client_explanation = @clientExplanation');
        values.clientExplanation = updates.clientExplanation;
    }

    if (fields.length === 0) return;

    const sql = `UPDATE vulnerabilities SET ${fields.join(', ')} WHERE cve_id = @cveId`;
    const stmt = getDb().prepare(sql);
    stmt.run(values);
    logger.info({ cveId, updates: Object.keys(updates) }, 'Updated vulnerability in database');
}

export function getAll() {
    const stmt = getDb().prepare('SELECT * FROM vulnerabilities');
    return stmt.all().map(row => {
        row.affectedTechnologies = row.affected_technologies ? JSON.parse(row.affected_technologies) : [];
        return row;
    });
}
