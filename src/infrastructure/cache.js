// src/infrastructure/cache.js

import fs from 'fs';
import path from 'path';

const CACHE_FILE = path.resolve('vuln-cache.json');
let sentVulnsCache = new Set();

/**
 * Generates a unique key for the vulnerability.
 * Prioritizes cveId, but uses the link as a fallback.
 * @param {Vulnerability} vuln
 * @returns {string} The unique key.
 */
function getCacheKey(vuln) {
    return vuln.cveId || vuln.link;
}

/**
 * Loads the cache from the JSON file into memory.
 * Should be called on application startup.
 */
function loadCache() {
    try {
        if (fs.existsSync(CACHE_FILE)) {
            const fileContent = fs.readFileSync(CACHE_FILE, 'utf-8');
            const cachedItems = JSON.parse(fileContent);
            sentVulnsCache = new Set(cachedItems);
            console.log(`[Cache] Cache loaded with ${sentVulnsCache.size} items.`);
        } else {
            console.log('[Cache] No cache file found. Starting a new one.');
        }
    } catch (error) {
        console.error('[Cache] Failed to load cache file:', error);
    }
}

/**
 * Saves the in-memory cache to the JSON file.
 */
function saveCache() {
    try {
        const cacheArray = Array.from(sentVulnsCache);
        fs.writeFileSync(CACHE_FILE, JSON.stringify(cacheArray, null, 2));
        console.log(`[Cache] Cache saved with ${sentVulnsCache.size} items.`);
    } catch (error) {
        console.error('[Cache] Failed to save cache file:', error);
    }
}

/**
 * Checks if a vulnerability is already in the cache.
 * @param {Vulnerability} vuln
 * @returns {boolean}
 */
function has(vuln) {
    return sentVulnsCache.has(getCacheKey(vuln));
}

/**
 * Adds a vulnerability to the cache.
 * @param {Vulnerability} vuln
 */
function add(vuln) {
    sentVulnsCache.add(getCacheKey(vuln));
}

export { loadCache, saveCache, has, add };