/**
 * Shared constants and helpers for all feed implementations.
 */
import logger from '../logger.js';

export const FEED_TIMEOUT_MS = parseInt(process.env.FEED_TIMEOUT_MS, 10) || 15000;
export const USER_AGENT = 'Atalaia/1.0 (security-monitor; jacksonfdam@gmail.com)';
export const MAX_RETRIES = 1;
export const RETRY_DELAY_MS = 5000;

const CVE_PATTERN = /CVE-\d{4}-\d{4,}/i;

/**
 * Map a CVSS base score onto the severity vocabulary the domain uses.
 * @param {number|null|undefined} score
 * @returns {string}
 */
export function cvssToSeverity(score) {
    const value = Number(score);
    if (!Number.isFinite(value)) return 'Unknown';
    if (value >= 9.0) return 'Critical';
    if (value >= 7.0) return 'High';
    if (value >= 4.0) return 'Medium';
    if (value >= 0.1) return 'Low';
    return 'Unknown';
}

/**
 * First CVE identifier mentioned in a blob of text, uppercased.
 *
 * Several advisory sources publish their own identifier (ZDI-26-563,
 * CERTFR-2026-AVI-0562) and only mention the CVE in prose, but the CVE is what
 * the rest of the pipeline deduplicates on.
 *
 * @param {...(string|null|undefined)} texts
 * @returns {string|null}
 */
export function extractCveId(...texts) {
    for (const text of texts) {
        const match = String(text ?? '').match(CVE_PATTERN);
        if (match) return match[0].toUpperCase();
    }
    return null;
}

/**
 * Execute a fetch function with retry logic.
 * @param {string} feedName - Name for logging
 * @param {() => Promise<any>} fn - The fetch function to retry
 * @returns {Promise<any>}
 */
export async function withRetry(feedName, fn) {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            return await fn();
        } catch (error) {
            if (attempt < MAX_RETRIES) {
                logger.warn({ feed: feedName, attempt: attempt + 1, retryMs: RETRY_DELAY_MS }, 'Feed attempt failed, retrying');
                await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
            } else {
                throw error;
            }
        }
    }
}
