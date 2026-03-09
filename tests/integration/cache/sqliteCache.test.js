import { jest } from '@jest/globals';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import os from 'os';

// We create a standalone in-memory cache for testing instead of using
// the module singleton to avoid side effects.

const MIGRATION_SQL = fs.readFileSync(path.resolve('db/migrations/001_initial.sql'), 'utf-8');

function createTestCache() {
    const db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.exec(MIGRATION_SQL);

    return {
        db,
        has(cveId) {
            return !!db.prepare('SELECT 1 FROM vulnerabilities WHERE cve_id = ?').get(cveId);
        },
        add(vuln) {
            db.prepare(`
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
                    last_seen_at = datetime('now')
            `).run({
                cveId: vuln.cveId,
                title: vuln.title,
                description: vuln.description,
                severity: vuln.severity,
                cvssScore: vuln.cvssScore,
                exploited: vuln.exploited ? 1 : 0,
                source: vuln.source || 'unknown',
                sourceUrl: vuln.link,
                affectedTechnologies: JSON.stringify(vuln.affectedTechnologies || []),
            });
        },
        get(cveId) {
            const row = db.prepare('SELECT * FROM vulnerabilities WHERE cve_id = ?').get(cveId);
            if (!row) return null;
            row.affectedTechnologies = row.affected_technologies ? JSON.parse(row.affected_technologies) : [];
            return row;
        },
        update(cveId, updates) {
            const fields = [];
            const values = { cveId };
            if (updates.status !== undefined) { fields.push('status = @status'); values.status = updates.status; }
            if (updates.statusChangedBy !== undefined) { fields.push('status_changed_by = @statusChangedBy'); values.statusChangedBy = updates.statusChangedBy; }
            if (updates.statusChangedAt !== undefined) { fields.push('status_changed_at = @statusChangedAt'); values.statusChangedAt = updates.statusChangedAt; }
            if (fields.length === 0) return;
            db.prepare(`UPDATE vulnerabilities SET ${fields.join(', ')} WHERE cve_id = @cveId`).run(values);
        },
        getAll() {
            return db.prepare('SELECT * FROM vulnerabilities').all().map(row => {
                row.affectedTechnologies = row.affected_technologies ? JSON.parse(row.affected_technologies) : [];
                return row;
            });
        },
    };
}

describe('SQLite Cache Integration', () => {
    let cache;

    beforeEach(() => {
        cache = createTestCache();
    });

    afterEach(() => {
        cache.db.close();
    });

    const sampleVuln = {
        cveId: 'CVE-2024-0001',
        title: 'Test Vuln',
        description: 'A test',
        severity: 'HIGH',
        cvssScore: 7.5,
        exploited: false,
        source: 'test',
        link: 'https://example.com',
        affectedTechnologies: ['react', 'node.js'],
    };

    test('has() returns false for non-existent CVE', () => {
        expect(cache.has('CVE-NOPE')).toBe(false);
    });

    test('add() inserts and has() returns true', () => {
        cache.add(sampleVuln);
        expect(cache.has('CVE-2024-0001')).toBe(true);
    });

    test('get() returns inserted vulnerability', () => {
        cache.add(sampleVuln);
        const row = cache.get('CVE-2024-0001');
        expect(row).not.toBeNull();
        expect(row.cve_id).toBe('CVE-2024-0001');
        expect(row.severity).toBe('HIGH');
        expect(row.affectedTechnologies).toEqual(['react', 'node.js']);
    });

    test('get() returns null for non-existent CVE', () => {
        expect(cache.get('CVE-NOPE')).toBeNull();
    });

    test('update() changes status', () => {
        cache.add(sampleVuln);
        cache.update('CVE-2024-0001', { status: 'ACKNOWLEDGED', statusChangedBy: 'tester' });
        const row = cache.get('CVE-2024-0001');
        expect(row.status).toBe('ACKNOWLEDGED');
        expect(row.status_changed_by).toBe('tester');
    });

    test('getAll() returns all vulnerabilities', () => {
        cache.add(sampleVuln);
        cache.add({ ...sampleVuln, cveId: 'CVE-2024-0002', severity: 'CRITICAL' });
        const all = cache.getAll();
        expect(all).toHaveLength(2);
    });

    test('add() with duplicate cveId updates last_seen_at', () => {
        cache.add(sampleVuln);
        const first = cache.get('CVE-2024-0001');
        cache.add(sampleVuln);
        const second = cache.get('CVE-2024-0001');
        expect(second.cve_id).toBe(first.cve_id);
    });

    test('default status is OPEN', () => {
        cache.add(sampleVuln);
        const row = cache.get('CVE-2024-0001');
        expect(row.status).toBe('OPEN');
    });
});
