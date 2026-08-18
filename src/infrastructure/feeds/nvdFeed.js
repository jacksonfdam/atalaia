import axios from 'axios';
import Vulnerability from '../../domain/entities/Vulnerability.js';
import logger from '../logger.js';
import { FEED_TIMEOUT_MS, USER_AGENT, withRetry } from './feedUtils.js';

const NVD_API_URL = 'https://services.nvd.nist.gov/rest/json/cves/2.0';

function cvssToSeverity(score) {
    if (score >= 9.0) return 'Critical';
    if (score >= 7.0) return 'High';
    if (score >= 4.0) return 'Medium';
    if (score >= 0.1) return 'Low';
    return 'Unknown';
}

/**
 * Extract the best CVSS score from NVD metrics (prefer v3.1, then v3.0, then v2.0).
 */
function extractCvss(metrics) {
    if (!metrics) return { score: null, severity: 'Unknown' };

    const v31 = metrics.cvssMetricV31?.[0]?.cvssData;
    if (v31) return { score: v31.baseScore, severity: cvssToSeverity(v31.baseScore) };

    const v30 = metrics.cvssMetricV30?.[0]?.cvssData;
    if (v30) return { score: v30.baseScore, severity: cvssToSeverity(v30.baseScore) };

    const v2 = metrics.cvssMetricV2?.[0]?.cvssData;
    if (v2) return { score: v2.baseScore, severity: cvssToSeverity(v2.baseScore) };

    return { score: null, severity: 'Unknown' };
}

/**
 * Fetch recent vulnerabilities from NVD API (last 7 days).
 * @returns {Promise<Vulnerability[]>}
 */
export async function fetch() {
    return withRetry('nvdFeed', async () => {
        logger.info('Fetching NVD recent CVEs');

        // Fetch CVEs published in the last 7 days
        const now = new Date();
        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const pubStartDate = weekAgo.toISOString().split('.')[0];
        const pubEndDate = now.toISOString().split('.')[0];

        const { data } = await axios.get(NVD_API_URL, {
            timeout: FEED_TIMEOUT_MS,
            headers: { 'User-Agent': USER_AGENT },
            params: {
                pubStartDate,
                pubEndDate,
                resultsPerPage: 100,
            },
        });

        if (!data.vulnerabilities || data.vulnerabilities.length === 0) {
            logger.info('No NVD vulnerabilities found');
            return [];
        }

        logger.info({ count: data.vulnerabilities.length }, 'Found NVD CVEs');

        const vulns = data.vulnerabilities.map(item => {
            const cve = item.cve;
            const cveId = cve.id;
            const description = cve.descriptions?.find(d => d.lang === 'en')?.value || 'No description';
            const { score, severity } = extractCvss(cve.metrics);
            const sourceUrl = `https://nvd.nist.gov/vuln/detail/${cveId}`;
            const published = cve.published ?? null;

            return new Vulnerability({
                cveId,
                title: `${cveId} - ${description.substring(0, 60)}...`,
                description,
                publishedDate: published,
                type: 'Unknown',
                severity,
                cvssScore: score,
                source: 'nvd',
                link: sourceUrl,
                exploited: false,
            });
        });

        logger.info({ count: vulns.length }, 'Successfully parsed NVD vulnerabilities');
        return vulns;
    });
}
