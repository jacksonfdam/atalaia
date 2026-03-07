// src/application/monitorVulns.js

import { fetch as fetchCisa } from '../infrastructure/feeds/cisaFeed.js';
import { fetch as fetchSnyk } from '../infrastructure/feeds/snykFeed.js';
import { fetch as fetchVuldb } from '../infrastructure/feeds/vuldbFeed.js';
import { fetch as fetchCveDetails } from '../infrastructure/feeds/cveDetailsFeed.js';
import { fetch as fetchNvd } from '../infrastructure/feeds/nvdFeed.js';
import notifySlack from '../infrastructure/notifySlack.js';
import { has, add } from '../infrastructure/cache/sqliteCache.js';
import config from '../infrastructure/config.js';

const FEED_DELAY_MS = parseInt(process.env.FEED_DELAY_MS, 10) || 2000;

const feeds = [
    { name: 'nvd', fetch: fetchNvd },
    { name: 'cisa', fetch: fetchCisa },
    { name: 'snyk', fetch: fetchSnyk },
    { name: 'vuldb', fetch: fetchVuldb },
    { name: 'cvedetails', fetch: fetchCveDetails },
];

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function filterByTechnology(vulns) {
    const { enabled, technologies } = config.filterSettings || {};

    if (!enabled || !technologies || technologies.length === 0) {
        return vulns;
    }

    console.log(`[atalaia] Filtering enabled. Applying filter for ${technologies.length} technologies.`);

    return vulns.filter(vuln => {
        const searchableText = `${vuln.title} ${vuln.description} ${vuln.link}`.toLowerCase();
        return technologies.some(tech => searchableText.includes(tech));
    });
}

async function fetchAllFeeds() {
    const allVulns = [];

    const results = await Promise.allSettled(
        feeds.map(async (feed, index) => {
            // Stagger feed fetches to avoid rate limiting
            if (index > 0) await delay(FEED_DELAY_MS * index);

            try {
                const vulns = await feed.fetch();
                console.log(`[atalaia] Feed '${feed.name}' returned ${vulns.length} vulnerabilities.`);
                return { name: feed.name, vulns };
            } catch (error) {
                console.error(`[atalaia] Feed '${feed.name}' failed: ${error.message}`);
                return { name: feed.name, vulns: [] };
            }
        })
    );

    for (const result of results) {
        if (result.status === 'fulfilled' && result.value.vulns.length > 0) {
            allVulns.push(...result.value.vulns);
        }
    }

    return allVulns;
}

async function monitorVulns() {
    try {
        console.log(`[atalaia] Starting vulnerability monitoring cycle...`);

        const allVulns = await fetchAllFeeds();
        console.log(`[atalaia] Fetched a total of ${allVulns.length} vulnerabilities from all sources.`);

        const relevantVulns = filterByTechnology(allVulns);
        if (config.filterSettings?.enabled) {
            console.log(`[atalaia] ${relevantVulns.length} vulnerabilities remain after filtering.`);
        }

        // Deduplicate against cache using cveId string (fixes bug: was passing full object)
        const newVulns = relevantVulns.filter(vuln => vuln.cveId && !has(vuln.cveId));

        if (newVulns.length === 0) {
            console.log('[atalaia] No new, relevant vulnerabilities found.');
            return;
        }

        console.log(`[atalaia] Found ${newVulns.length} new, relevant vulnerabilities to report.`);

        for (const vuln of newVulns) {
            const highlight = vuln.isCritical() || vuln.isExploited();
            await notifySlack(vuln, highlight);
            add(vuln);
        }

        console.log('[atalaia] Monitoring cycle completed.');
    } catch (error) {
        console.error('[atalaia] Error in monitorVulns:', error);
    }
}

export default monitorVulns;
