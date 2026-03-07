// src/infrastructure/cache.js

import fs from 'fs';
import path from 'path';
import logger from './logger.js';

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
            logger.info({ size: sentVulnsCache.size }, 'Cache loaded');
        } else {
            logger.info('No cache file found, starting fresh');
        }
    } catch (error) {
        logger.error({ err: error }, 'Failed to load cache file');
    }
}

/**
 * Saves the in-memory cache to the JSON file.
 */
function saveCache() {
    try {
        const cacheArray = Array.from(sentVulnsCache);
        fs.writeFileSync(CACHE_FILE, JSON.stringify(cacheArray, null, 2));
        logger.info({ size: sentVulnsCache.size }, 'Cache saved');
    } catch (error) {
        logger.error({ err: error }, 'Failed to save cache file');
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