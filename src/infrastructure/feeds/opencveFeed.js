import axios from 'axios';
import Vulnerability from '../../domain/entities/Vulnerability.js';
import logger from '../logger.js';
import config from '../config.js';
import { FEED_TIMEOUT_MS, USER_AGENT, withRetry } from './feedUtils.js';

const DEFAULT_API_URL = 'https://app.opencve.io/api';
const MAX_PAGES = 10; // Safety limit to avoid infinite pagination

/**
 * Fetch vulnerabilities from OpenCVE REST API.
 * Requires OPENCVE_API_URL and OPENCVE_API_TOKEN environment variables.
 *
 * @returns {Promise<Vulnerability[]>}
 */
export async function fetch() {
    const apiUrl = config.opencve?.apiUrl || process.env.OPENCVE_API_URL || DEFAULT_API_URL;
    const token = config.opencve?.token || process.env.OPENCVE_API_TOKEN;

    if (!token) {
        logger.warn('OpenCVE API token not configured, skipping feed');
        return [];
    }

    return withRetry('opencve', async () => {
        logger.info('Fetching OpenCVE vulnerabilities via REST API');

        const vulns = [];
        let page = 1;
        let hasNext = true;

        while (hasNext && page <= MAX_PAGES) {
            const result = await fetchPage(apiUrl, token, page);
            if (!result) break;

            for (const cve of result.results) {
                const vuln = mapCveToVulnerability(cve);
                if (vuln) vulns.push(vuln);
            }

            hasNext = result.next !== null;
            page++;
        }

        logger.info({ count: vulns.length }, 'Successfully fetched OpenCVE vulnerabilities');
        return vulns;
    });
}

/**
 * Fetch a single page of CVEs from the OpenCVE API.
 * @param {string} apiUrl
 * @param {string} token
 * @param {number} page
 * @returns {Promise<{ count: number, next: string|null, previous: string|null, results: object[] } | null>}
 */
async function fetchPage(apiUrl, token, page) {
    try {
        const response = await axios.get(`${apiUrl}/cve`, {
            timeout: FEED_TIMEOUT_MS,
            headers: {
                'User-Agent': USER_AGENT,
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/json',
            },
            params: {
                page,
            },
        });

        return response.data;
    } catch (error) {
        if (error.response?.status === 401) {
            logger.error('OpenCVE API authentication failed — check OPENCVE_API_TOKEN');
            return null;
        }
        if (error.response?.status === 404) {
            logger.warn({ page }, 'OpenCVE API returned 404');
            return null;
        }
        logger.error({ page, err: error.message, status: error.response?.status }, 'OpenCVE API request failed');
        throw error;
    }
}

/**
 * Map an OpenCVE API CVE object to a Vulnerability entity.
 * @param {object} cve - CVE from OpenCVE API response
 * @returns {Vulnerability|null}
 */
function mapCveToVulnerability(cve) {
    try {
        const cveId = cve.cve_id || cve.id;
        if (!cveId) return null;

        // Extract description
        const description = cve.description || cve.title || 'No description available';
        const title = cve.title || cveId;

        // Extract CVSS score — try multiple sources
        const cvssScore = extractCvssScore(cve);
        const severity = determineSeverity(cvssScore, cve);

        // Extract vendor/product info for affectedTechnologies
        const affectedTechnologies = extractAffectedTechnologies(cve);

        // Extract published date
        const publishedDate = cve.created_at || cve.updated_at || null;

        // Build link
        const link = `https://www.opencve.io/cve/${cveId}`;

        return new Vulnerability({
            cveId,
            title: `${cveId} - ${title}`,
            description,
            publishedDate,
            severity,
            cvssScore,
            source: 'opencve',
            link,
            exploited: cve.kev === true,
            type: 'Unknown',
            affectedTechnologies,
        });
    } catch (error) {
        logger.warn({ cve: cve?.cve_id, err: error.message }, 'Failed to map OpenCVE CVE');
        return null;
    }
}

/**
 * Extract the best available CVSS score from the CVE data.
 * @param {object} cve
 * @returns {number|null}
 */
function extractCvssScore(cve) {
    // Try metrics object (detailed view)
    if (cve.metrics) {
        if (cve.metrics.cvssV3_1?.score) return cve.metrics.cvssV3_1.score;
        if (cve.metrics.cvssV3_0?.score) return cve.metrics.cvssV3_0.score;
        if (cve.metrics.cvssV2_0?.score) return cve.metrics.cvssV2_0.score;
    }

    // Try flat cvss field
    if (typeof cve.cvss === 'number') return cve.cvss;
    if (cve.cvss?.score) return cve.cvss.score;

    return null;
}

/**
 * Determine severity from CVSS score or API-provided severity.
 * @param {number|null} cvssScore
 * @param {object} cve
 * @returns {string}
 */
function determineSeverity(cvssScore, cve) {
    // Use API-provided severity if available
    if (cve.severity) {
        const upper = String(cve.severity).toUpperCase();
        if (['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].includes(upper)) return upper;
    }

    // Fall back to CVSS-based severity
    if (cvssScore === null || cvssScore === undefined) return 'UNKNOWN';
    if (cvssScore >= 9.0) return 'CRITICAL';
    if (cvssScore >= 7.0) return 'HIGH';
    if (cvssScore >= 4.0) return 'MEDIUM';
    if (cvssScore >= 0.1) return 'LOW';
    return 'UNKNOWN';
}

/**
 * Extract affected technologies from vendor/product data.
 * @param {object} cve
 * @returns {string[]}
 */
function extractAffectedTechnologies(cve) {
    const techs = new Set();

    // Extract from vendors object (OpenCVE format: { "vendor": ["product1", "product2"] })
    if (cve.vendors && typeof cve.vendors === 'object') {
        for (const [vendor, products] of Object.entries(cve.vendors)) {
            techs.add(vendor);
            if (Array.isArray(products)) {
                products.forEach(p => techs.add(p));
            }
        }
    }

    // Extract from products array if present
    if (Array.isArray(cve.products)) {
        cve.products.forEach(p => {
            if (typeof p === 'string') techs.add(p);
            if (p?.name) techs.add(p.name);
        });
    }

    return [...techs];
}
