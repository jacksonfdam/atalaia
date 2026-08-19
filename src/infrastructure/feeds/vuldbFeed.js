import Parser from 'rss-parser';
import Vulnerability from '../../domain/entities/Vulnerability.js';
import config from '../config.js';
import logger from '../logger.js';
import { FEED_TIMEOUT_MS, USER_AGENT, withRetry } from './feedUtils.js';

const parser = new Parser({
    timeout: FEED_TIMEOUT_MS,
    headers: { 'User-Agent': USER_AGENT },
});

/**
 * What is missing before this source can be called at all.
 * @returns {string|null}
 */
export function unconfiguredReason() {
    return config.feeds?.vuldbRss ? null : 'No RSS URL. Set feeds.vuldbRss in config.json.';
}

/**
 * Fetch vulnerabilities from VulDB RSS feed.
 * @returns {Promise<Vulnerability[]>}
 */
export async function fetch() {
    const missing = unconfiguredReason();
    if (missing) {
        logger.warn({ reason: missing }, 'VulDB feed not configured, skipping');
        return [];
    }

    const url = config.feeds.vuldbRss;

    return withRetry('vuldbFeed', async () => {
        logger.info('Fetching VulDB RSS feed');
        const feed = await parser.parseURL(url);

        if (!feed.items || feed.items.length === 0) {
            logger.info('No items found in VulDB RSS feed');
            return [];
        }

        logger.info({ count: feed.items.length }, 'Found VulDB RSS items');

        const vulns = feed.items.map(item => {
            const cveMatch = item.title.match(/(CVE-\d{4,}-\d{4,})/);
            const cveId = cveMatch ? cveMatch[0] : null;

            let severity = 'Unknown';
            const titleLower = item.title.toLowerCase();
            if (titleLower.includes('critical')) severity = 'Critical';
            else if (titleLower.includes('high')) severity = 'High';
            else if (titleLower.includes('medium')) severity = 'Medium';
            else if (titleLower.includes('low')) severity = 'Low';

            return new Vulnerability({
                cveId,
                title: item.title,
                description: item.contentSnippet || 'No description available.',
                publishedDate: item.pubDate,
                type: 'Unknown',
                severity,
                source: 'vuldb',
                link: item.link,
                exploited: false,
            });
        });

        logger.info({ count: vulns.length }, 'Successfully parsed VulDB vulnerabilities');
        return vulns;
    });
}
