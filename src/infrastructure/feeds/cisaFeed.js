import axios from 'axios';
import Vulnerability from '../../domain/entities/Vulnerability.js';
import config from '../config.js';
import { FEED_TIMEOUT_MS, USER_AGENT, withRetry } from './feedUtils.js';

/**
 * Fetch vulnerabilities from CISA Known Exploited Vulnerabilities JSON feed.
 * @returns {Promise<Vulnerability[]>}
 */
export async function fetch() {
    const url = config.feeds?.cisaJson;
    if (!url) {
        console.log('[cisaFeed] No CISA feed URL configured, skipping');
        return [];
    }

    return withRetry('cisaFeed', async () => {
        console.log('[cisaFeed] Fetching CISA KEV feed...');
        const { data } = await axios.get(url, {
            timeout: FEED_TIMEOUT_MS,
            headers: { 'User-Agent': USER_AGENT },
        });

        if (!data.vulnerabilities || data.vulnerabilities.length === 0) {
            console.log('[cisaFeed] No vulnerabilities found in the feed.');
            return [];
        }

        console.log(`[cisaFeed] Found ${data.vulnerabilities.length} potential vulnerabilities.`);

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

        console.log(`[cisaFeed] Successfully parsed ${vulns.length} vulnerabilities.`);
        return vulns;
    });
}
