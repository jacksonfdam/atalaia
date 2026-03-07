import Parser from 'rss-parser';
import Vulnerability from '../../domain/entities/Vulnerability.js';
import config from '../config.js';
import { FEED_TIMEOUT_MS, USER_AGENT, withRetry } from './feedUtils.js';

const parser = new Parser({
    timeout: FEED_TIMEOUT_MS,
    headers: { 'User-Agent': USER_AGENT },
});

/**
 * Fetch vulnerabilities from VulDB RSS feed.
 * @returns {Promise<Vulnerability[]>}
 */
export async function fetch() {
    const url = config.feeds?.vuldbRss;
    if (!url) {
        console.log('[vuldbFeed] No VulDB RSS feed URL configured, skipping');
        return [];
    }

    return withRetry('vuldbFeed', async () => {
        console.log('[vuldbFeed] Fetching VulDB RSS feed...');
        const feed = await parser.parseURL(url);

        if (!feed.items || feed.items.length === 0) {
            console.log('[vuldbFeed] No items found in the RSS feed.');
            return [];
        }

        console.log(`[vuldbFeed] Found ${feed.items.length} items in the feed.`);

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

        console.log(`[vuldbFeed] Successfully parsed ${vulns.length} vulnerabilities.`);
        return vulns;
    });
}
