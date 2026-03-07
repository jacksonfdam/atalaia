import axios from 'axios';
import Vulnerability from '../../domain/entities/Vulnerability.js';
import config from '../config.js';
import logger from '../logger.js';
import { FEED_TIMEOUT_MS, USER_AGENT, withRetry } from './feedUtils.js';

/**
 * Fetch vulnerabilities from CISA Known Exploited Vulnerabilities JSON feed.
 * @returns {Promise<Vulnerability[]>}
 */
export async function fetch() {
    const url = config.feeds?.cisaJson;
    if (!url) {
        logger.warn('No CISA feed URL configured, skipping');
        return [];
    }

    return withRetry('cisaFeed', async () => {
        logger.info('Fetching CISA KEV feed');
        const { data } = await axios.get(url, {
            timeout: FEED_TIMEOUT_MS,
            headers: { 'User-Agent': USER_AGENT },
        });

        if (!data.vulnerabilities || data.vulnerabilities.length === 0) {
            logger.info('No vulnerabilities found in CISA feed');
            return [];
        }

        logger.info({ count: data.vulnerabilities.length }, 'Found potential CISA vulnerabilities');

        const vulns = data.vulnerabilities.map(item => new Vulnerability({
            cveId: item.cveID || null,
            title: item.vendorProject
                ? `${item.vendorProject} ${item.vulnerabilityName}`
                : item.vulnerabilityName,
            description: item.shortDescription || 'No description available',
            publishedDate: item.dateAdded || new Date().toISOString(),
            type: 'Unknown',
            severity: 'Critical',
            source: 'cisa',
            link: item.notes || url,
            exploited: true,
        }));

        logger.info({ count: vulns.length }, 'Successfully parsed CISA vulnerabilities');
        return vulns;
    });
}
