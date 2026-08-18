import axios from 'axios';
import Vulnerability from '../../domain/entities/Vulnerability.js';
import logger from '../logger.js';
import { FEED_TIMEOUT_MS, USER_AGENT, cvssToSeverity, withRetry } from './feedUtils.js';

const REDHAT_API_URL = 'https://access.redhat.com/hydra/rest/securitydata/cve.json';
const PAGE_SIZE = parseInt(process.env.REDHAT_PAGE_SIZE, 10) || 100;

/**
 * Red Hat Security Data API.
 *
 * Red Hat rates a CVE by its impact on Red Hat products, which is not always
 * the upstream CVSS severity — the score is kept alongside so both are visible.
 *
 * @returns {Promise<Vulnerability[]>}
 */
export async function fetch() {
    return withRetry('redhatFeed', async () => {
        logger.info('Fetching Red Hat security data');

        const { data } = await axios.get(REDHAT_API_URL, {
            timeout: FEED_TIMEOUT_MS,
            headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
            params: { per_page: PAGE_SIZE },
        });

        if (!Array.isArray(data) || data.length === 0) {
            logger.info('No CVEs returned by Red Hat');
            return [];
        }

        const vulns = data.map(item => {
            const score = item.cvss3_score ? Number(item.cvss3_score) : null;

            return new Vulnerability({
                cveId: item.CVE ?? null,
                title: item.bugzilla_description || item.CVE,
                description: item.bugzilla_description || 'No description available.',
                publishedDate: item.public_date ?? null,
                type: Array.isArray(item.CWE) ? item.CWE.join(', ') : item.CWE ?? 'Unknown',
                // Red Hat's own rating is the more useful one for its packages;
                // fall back to the score when a CVE is still unrated.
                severity: item.severity || cvssToSeverity(score),
                source: 'redhat',
                link: item.resource_url || `https://access.redhat.com/security/cve/${item.CVE}`,
                exploited: false,
                cvssScore: score,
                affectedTechnologies: item.affected_packages ?? [],
            });
        });

        logger.info({ count: vulns.length }, 'Successfully parsed Red Hat CVEs');
        return vulns;
    });
}
