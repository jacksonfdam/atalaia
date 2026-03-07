/**
 * Shared constants and helpers for all feed implementations.
 */

export const FEED_TIMEOUT_MS = parseInt(process.env.FEED_TIMEOUT_MS, 10) || 15000;
export const USER_AGENT = 'Atalaia/1.0 (security-monitor; jacksonfdam@gmail.com)';
export const MAX_RETRIES = 1;
export const RETRY_DELAY_MS = 5000;

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
                console.log(`[${feedName}] Attempt ${attempt + 1} failed, retrying in ${RETRY_DELAY_MS}ms...`);
                await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
            } else {
                throw error;
            }
        }
    }
}
