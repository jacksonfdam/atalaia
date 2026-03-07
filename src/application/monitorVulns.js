// src/application/monitorVulns.js

import Vulnerability from '../domain/entities/Vulnerability.js';
import { fetch as fetchCisa } from '../infrastructure/feeds/cisaFeed.js';
import { fetch as fetchSnyk } from '../infrastructure/feeds/snykFeed.js';
import { fetch as fetchVuldb } from '../infrastructure/feeds/vuldbFeed.js';
import { fetch as fetchCveDetails } from '../infrastructure/feeds/cveDetailsFeed.js';
import { fetch as fetchNvd } from '../infrastructure/feeds/nvdFeed.js';
import notifySlack from '../infrastructure/notifySlack.js';
import { has, add } from '../infrastructure/cache/sqliteCache.js';
import config from '../infrastructure/config.js';

const FEED_DELAY_MS = parseInt(process.env.FEED_DELAY_MS, 10) || 2000;

/**
 * Source priority: lower index = higher priority.
 * When the same CVE appears in multiple feeds, the highest-priority source wins
 * for severity, description, and source fields.
 */
const SOURCE_PRIORITY = ['nvd', 'cisa', 'snyk', 'vuldb', 'cvedetails'];

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

function getPriorityScore(source) {
    const index = SOURCE_PRIORITY.indexOf(source?.toLowerCase());
    return index >= 0 ? index : SOURCE_PRIORITY.length;
}

/**
 * Merge multiple vulnerabilities with the same CVE ID.
 * Rules:
 *   - severity, description, source, link: from highest-priority source
 *   - exploited: OR logic (true if ANY source says true)
 *   - cvssScore: first non-null from highest-priority source
 *   - affectedTechnologies: UNION of all sources (deduplicated)
 *
 * @param {Vulnerability[]} vulnsWithSameCve
 * @returns {Vulnerability}
 */
function mergeVulnerabilities(vulnsWithSameCve) {
    if (vulnsWithSameCve.length === 1) return vulnsWithSameCve[0];

    const sorted = [...vulnsWithSameCve].sort(
        (a, b) => getPriorityScore(a.source) - getPriorityScore(b.source)
    );

    const primary = sorted[0];

    // Pick best cvssScore from highest-priority source that has one
    const cvssScore = sorted.find(v => v.cvssScore != null)?.cvssScore ?? null;

    return new Vulnerability({
        cveId: primary.cveId,
        title: primary.title,
        description: primary.description,
        publishedDate: primary.publishedDate,
        type: primary.type,
        severity: primary.severity,
        cvssScore,
        source: primary.source,
        link: primary.link,
        // OR logic: true if ANY source says exploited
        exploited: vulnsWithSameCve.some(v => v.exploited),
        // UNION of all technologies, deduplicated
        affectedTechnologies: [
            ...new Set(vulnsWithSameCve.flatMap(v => v.affectedTechnologies || [])),
        ],
    });
}

/**
 * Group vulnerabilities by CVE ID and merge duplicates.
 * Vulns without a cveId are kept as-is (no merging possible).
 * @param {Vulnerability[]} vulns
 * @returns {Vulnerability[]}
 */
function deduplicateAndMerge(vulns) {
    const byCveId = {};
    const noCveId = [];

    for (const vuln of vulns) {
        if (!vuln.cveId) {
            noCveId.push(vuln);
            continue;
        }
        if (!byCveId[vuln.cveId]) {
            byCveId[vuln.cveId] = [];
        }
        byCveId[vuln.cveId].push(vuln);
    }

    const merged = Object.values(byCveId).map(group => mergeVulnerabilities(group));
    return [...merged, ...noCveId];
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
        console.log('[atalaia] Starting vulnerability monitoring cycle...');

        const allVulns = await fetchAllFeeds();
        console.log(`[atalaia] Fetched a total of ${allVulns.length} vulnerabilities from all sources.`);

        // Merge duplicates from multiple feeds
        const mergedVulns = deduplicateAndMerge(allVulns);
        console.log(`[atalaia] ${mergedVulns.length} unique vulnerabilities after merge.`);

        const relevantVulns = filterByTechnology(mergedVulns);
        if (config.filterSettings?.enabled) {
            console.log(`[atalaia] ${relevantVulns.length} vulnerabilities remain after filtering.`);
        }

        // Deduplicate against cache (already persisted vulns)
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

// Exported for testing
export { SOURCE_PRIORITY, getPriorityScore, mergeVulnerabilities, deduplicateAndMerge };
export default monitorVulns;
