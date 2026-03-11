import axios from 'axios';
import Vulnerability from '../../domain/entities/Vulnerability.js';
import logger from '../logger.js';
import { FEED_TIMEOUT_MS, USER_AGENT, withRetry } from './feedUtils.js';

/**
 * Fetch vulnerabilities from OpenCVE Knowledge Base (GitHub repository).
 * OpenCVE provides a comprehensive KB with CVE data from multiple sources.
 *
 * Data source: https://github.com/opencve/opencve-kb
 * Structure: Individual JSON files per CVE in yearly directories
 *
 * @returns {Promise<Vulnerability[]>}
 */
export async function fetch() {
    return withRetry('opencve', async () => {
        logger.info('Fetching OpenCVE vulnerabilities');

        // Fetch recent CVEs from 2025 (or 2024 if 2026 not available yet)
        const vulns = await fetchCVEsFromYear(2025);

        if (!vulns || vulns.length === 0) {
            logger.info('No vulnerabilities found in OpenCVE');
            return [];
        }

        logger.info({ count: vulns.length }, 'Successfully parsed OpenCVE vulnerabilities');
        return vulns;
    });
}

/**
 * Fetch CVE list from GitHub API for a given year.
 * @param {number} year - Year to fetch (e.g., 2025)
 * @returns {Promise<Vulnerability[]>}
 */
async function fetchCVEsFromYear(year) {
    const baseUrl = `https://api.github.com/repos/opencve/opencve-kb/contents/${year}`;

    try {
        // Fetch directory listing from GitHub
        const response = await axios.get(baseUrl, {
            timeout: FEED_TIMEOUT_MS,
            headers: {
                'User-Agent': USER_AGENT,
                // GitHub API may require Accept header
                'Accept': 'application/vnd.github.v3+json',
            },
            params: {
                per_page: 100, // Fetch up to 100 files per page
            },
        });

        if (!Array.isArray(response.data)) {
            logger.warn({ year }, 'Invalid response format from OpenCVE KB');
            return [];
        }

        // Filter to JSON files matching CVE pattern (CVE-YYYY-XXXXX.json)
        const cveFiles = response.data.filter(
            (item) => item.type === 'file' && item.name.match(/^CVE-\d{4}-\d{4,}\.json$/)
        );

        if (cveFiles.length === 0) {
            logger.info({ year }, 'No CVE files found for year');
            return [];
        }

        logger.info({ year, count: cveFiles.length }, 'Found CVE files');

        // Fetch individual CVE JSON files (limit to prevent rate limiting)
        const vulns = [];
        const maxCVEs = 50; // Limit to recent 50 CVEs to avoid rate limits and long processing

        for (let i = 0; i < Math.min(cveFiles.length, maxCVEs); i++) {
            const cveFile = cveFiles[i];
            try {
                const cveData = await fetchCVEData(year, cveFile.name);
                if (cveData) {
                    vulns.push(cveData);
                }
            } catch (error) {
                logger.warn(
                    { cve: cveFile.name, err: error.message },
                    'Failed to fetch individual CVE'
                );
                // Continue with next CVE on error
            }

            // Small delay to respect GitHub API rate limits (no auth)
            if (i < Math.min(cveFiles.length, maxCVEs) - 1) {
                await sleep(100);
            }
        }

        logger.info({ parsed: vulns.length, total: cveFiles.length }, 'Processed OpenCVE files');
        return vulns;
    } catch (error) {
        logger.error({ year, err: error }, 'Failed to fetch OpenCVE directory');
        return [];
    }
}

/**
 * Fetch a single CVE JSON file from GitHub raw content.
 * @param {number} year
 * @param {string} fileName - CVE-YYYY-XXXXX.json
 * @returns {Promise<Vulnerability|null>}
 */
async function fetchCVEData(year, fileName) {
    const rawUrl = `https://raw.githubusercontent.com/opencve/opencve-kb/main/${year}/${fileName}`;

    const { data } = await axios.get(rawUrl, {
        timeout: FEED_TIMEOUT_MS,
        headers: { 'User-Agent': USER_AGENT },
    });

    if (!data || !data.cve) {
        return null;
    }

    // Extract data from MITRE/NVD sources (prefer MITRE, fallback to NVD)
    const cveId = data.cve;
    const mitreData = data.mitre || {};
    const nvdData = data.nvd || {};
    const epssScore = data.epss?.score || null;

    // Get best available description
    const description = mitreData.description || nvdData.description || 'No description available';

    // Get best available CVSS score (prefer v3.1 > v3.0 > v2.0)
    let cvssScore = null;
    let cvssVector = null;

    if (mitreData.metrics?.cvssV3_1?.score) {
        cvssScore = mitreData.metrics.cvssV3_1.score;
        cvssVector = mitreData.metrics.cvssV3_1.vector;
    } else if (mitreData.metrics?.cvssV3_0?.score) {
        cvssScore = mitreData.metrics.cvssV3_0.score;
        cvssVector = mitreData.metrics.cvssV3_0.vector;
    } else if (mitreData.metrics?.cvssV2_0?.score) {
        cvssScore = mitreData.metrics.cvssV2_0.score;
        cvssVector = mitreData.metrics.cvssV2_0.vector;
    } else if (nvdData.metrics?.cvssV3_1?.score) {
        cvssScore = nvdData.metrics.cvssV3_1.score;
        cvssVector = nvdData.metrics.cvssV3_1.vector;
    }

    // Determine severity from CVSS score
    const severity = determineSeverity(cvssScore);

    // Get published date (creation date)
    const publishedDate =
        mitreData.created || nvdData.created || new Date().toISOString();

    // Get title
    const title = mitreData.title || nvdData.title || cveId;

    // Get source URL (link to reference)
    const references = mitreData.references || nvdData.references || [];
    const link = references.length > 0 ? references[0] : `https://nvd.nist.gov/vuln/detail/${cveId}`;

    // Create Vulnerability entity
    return new Vulnerability({
        cveId,
        title: `${cveId} - ${title}`,
        description,
        publishedDate,
        severity,
        cvssScore,
        source: 'opencve',
        link,
        exploited: false, // OpenCVE KB doesn't track exploitation status
        type: 'Unknown',
        affectedTechnologies: [], // OpenCVE doesn't provide tech info in this format
    });
}

/**
 * Determine severity from CVSS score (v3.1 scale).
 * @param {number|null} cvssScore
 * @returns {string} One of: CRITICAL, HIGH, MEDIUM, LOW, UNKNOWN
 */
function determineSeverity(cvssScore) {
    if (cvssScore === null || cvssScore === undefined) {
        return 'UNKNOWN';
    }

    // CVSS v3.1 severity ratings
    if (cvssScore >= 9.0) return 'CRITICAL';
    if (cvssScore >= 7.0) return 'HIGH';
    if (cvssScore >= 4.0) return 'MEDIUM';
    if (cvssScore >= 0.1) return 'LOW';

    return 'UNKNOWN';
}

/**
 * Simple sleep utility for rate limiting.
 * @param {number} ms
 */
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
