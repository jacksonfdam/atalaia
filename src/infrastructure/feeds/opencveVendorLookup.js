import axios from 'axios';
import config from '../config.js';
import logger from '../logger.js';
import { getVendorProductMapping, setVendorProductMapping } from '../cache/repositoryStore.js';
import { FEED_TIMEOUT_MS, USER_AGENT } from './feedUtils.js';

const DEFAULT_API_URL = 'https://app.opencve.io/api';

/**
 * Resolve a dependency name to an OpenCVE vendor/product pair.
 * Checks local DB cache first, then queries the OpenCVE API.
 *
 * @param {string} ecosystem - e.g. 'NPM', 'PIP'
 * @param {string} packageName - e.g. 'express', 'django'
 * @returns {Promise<{ vendor: string, product: string } | null>}
 */
export async function resolveVendorProduct(ecosystem, packageName) {
    // 1. Check local cache
    const cached = await getVendorProductMapping(ecosystem, packageName);
    if (cached) return cached;

    // 2. Try OpenCVE API lookup
    const apiUrl = config.opencve?.apiUrl || process.env.OPENCVE_API_URL || DEFAULT_API_URL;
    const token = config.opencve?.token || process.env.OPENCVE_API_TOKEN;

    if (!token) return null; // Can't query API without token

    try {
        const result = await searchOpenCVE(apiUrl, token, packageName);
        if (result) {
            // Cache for future use
            await setVendorProductMapping(ecosystem, packageName, result.vendor, result.product);
            return result;
        }
    } catch (error) {
        logger.warn({ ecosystem, packageName, err: error.message }, 'OpenCVE vendor lookup failed');
    }

    return null;
}

/**
 * Search OpenCVE API for a vendor/product matching the package name.
 * @param {string} apiUrl
 * @param {string} token
 * @param {string} name
 * @returns {Promise<{ vendor: string, product: string } | null>}
 */
async function searchOpenCVE(apiUrl, token, name) {
    const headers = {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
        'User-Agent': USER_AGENT,
    };

    // Try product search first (more specific)
    try {
        const { data } = await axios.get(`${apiUrl}/products`, {
            headers,
            timeout: FEED_TIMEOUT_MS,
            params: { search: name },
        });

        if (data.results && data.results.length > 0) {
            // Find best match — exact match preferred
            const exact = data.results.find(
                p => p.name?.toLowerCase() === name.toLowerCase()
            );
            const match = exact || data.results[0];

            if (match.vendor && match.name) {
                const vendor = typeof match.vendor === 'string' ? match.vendor : match.vendor?.name;
                return { vendor, product: match.name };
            }
        }
    } catch (error) {
        if (error.response?.status !== 404) {
            logger.debug({ name, err: error.message }, 'OpenCVE product search failed');
        }
    }

    // Fall back to vendor search
    try {
        const { data } = await axios.get(`${apiUrl}/vendors`, {
            headers,
            timeout: FEED_TIMEOUT_MS,
            params: { search: name },
        });

        if (data.results && data.results.length > 0) {
            const exact = data.results.find(
                v => v.name?.toLowerCase() === name.toLowerCase()
            );
            const match = exact || data.results[0];

            if (match.name) {
                return { vendor: match.name, product: name.toLowerCase() };
            }
        }
    } catch (error) {
        if (error.response?.status !== 404) {
            logger.debug({ name, err: error.message }, 'OpenCVE vendor search failed');
        }
    }

    return null;
}

/**
 * Batch-resolve multiple dependencies. Throttles API calls.
 * @param {{ ecosystem: string, name: string }[]} deps
 * @returns {Promise<Map<string, { vendor: string, product: string }>>}
 */
export async function batchResolveVendorProducts(deps) {
    const results = new Map();
    const BATCH_DELAY_MS = 200; // Respect API rate limits

    for (const dep of deps) {
        const key = `${dep.ecosystem}:${dep.name}`;

        // Check cache first (no API call needed)
        const cached = await getVendorProductMapping(dep.ecosystem, dep.name);
        if (cached) {
            results.set(key, cached);
            continue;
        }

        // API call with throttle
        const result = await resolveVendorProduct(dep.ecosystem, dep.name);
        if (result) {
            results.set(key, result);
        }

        await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
    }

    return results;
}
