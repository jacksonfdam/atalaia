import fs from 'fs';
import path from 'path';
import { getDb } from '../src/infrastructure/cache/sqliteCache.js';

const CACHE_FILE = path.resolve('vuln-cache.json');

function migrate() {
    if (!fs.existsSync(CACHE_FILE)) {
        console.log('No vuln-cache.json found. Skipping migration.');
        return;
    }

    const fileContent = fs.readFileSync(CACHE_FILE, 'utf-8');
    let cachedItems;
    try {
        cachedItems = JSON.parse(fileContent);
    } catch (e) {
        console.error('Failed to parse vuln-cache.json:', e);
        return;
    }

    if (!Array.isArray(cachedItems)) {
        console.error('vuln-cache.json is not an array.');
        return;
    }

    const db = getDb();
    const insertStmt = db.prepare(`
        INSERT OR IGNORE INTO vulnerabilities (cve_id, source, description)
        VALUES (?, 'migration', 'Imported from legacy cache')
    `);

    let count = 0;
    db.transaction(() => {
        for (const item of cachedItems) {
            if (typeof item === 'string' && item.startsWith('CVE-')) {
                insertStmt.run(item);
                count++;
            }
        }
    })();

    console.log(`Migrated ${count} items from vuln-cache.json to SQLite.`);
    
    // Rename old cache file
    fs.renameSync(CACHE_FILE, CACHE_FILE + '.bak');
    console.log(`Renamed ${CACHE_FILE} to ${CACHE_FILE}.bak`);
}

migrate();
