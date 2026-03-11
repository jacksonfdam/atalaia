// src/application/monitorVulns.js

import Vulnerability from '../domain/entities/Vulnerability.js';
import { fetch as fetchCisa } from '../infrastructure/feeds/cisaFeed.js';
import { fetch as fetchSnyk } from '../infrastructure/feeds/snykFeed.js';
import { fetch as fetchVuldb } from '../infrastructure/feeds/vuldbFeed.js';
import { fetch as fetchCveDetails } from '../infrastructure/feeds/cveDetailsFeed.js';
import { fetch as fetchNvd } from '../infrastructure/feeds/nvdFeed.js';
import { fetch as fetchOpenCVE } from '../infrastructure/feeds/opencveFeed.js';
import { readFileSync } from 'fs';
import path from 'path';
import notifySlack from '../infrastructure/notifySlack.js';
import { has, add } from '../infrastructure/cache/sqliteCache.js';
import config from '../infrastructure/config.js';
import logger from '../infrastructure/logger.js';
import { createLLMAdapter, renderPrompt } from '../infrastructure/llm/llmAdapter.js';

const TECH_CONFIG_PATH = path.resolve('config/technologies.json');
const llm = createLLMAdapter();

const FEED_DELAY_MS = parseInt(process.env.FEED_DELAY_MS, 10) || 2000;

/**
 * Source priority: lower index = higher priority.
 * When the same CVE appears in multiple feeds, the highest-priority source wins
 * for severity, description, and source fields.
 */
const SOURCE_PRIORITY = ['nvd', 'cisa', 'opencve', 'snyk', 'vuldb', 'cvedetails'];

const feeds = [
    { name: 'nvd', fetch: fetchNvd },
    { name: 'cisa', fetch: fetchCisa },
    { name: 'opencve', fetch: fetchOpenCVE },
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

function loadTechFilters() {
    try {
        const data = readFileSync(TECH_CONFIG_PATH, 'utf-8');
        return JSON.parse(data);
    } catch {
        return null;
    }
}

function filterByTechnology(vulns) {
    // Try technologies.json first, fall back to config.json filterSettings
    const techConfig = loadTechFilters();
    const filters = techConfig?.filters;

    if (!filters || filters.length === 0) {
        const { enabled, technologies } = config.filterSettings || {};
        if (!enabled || !technologies || technologies.length === 0) return vulns;
        logger.info({ count: technologies.length }, 'Filtering from config.json filterSettings');
        return vulns.filter(vuln => {
            const text = `${vuln.title} ${vuln.description} ${vuln.link}`.toLowerCase();
            return technologies.some(tech => text.includes(tech));
        });
    }

    logger.info({ count: filters.length }, 'Filtering from config/technologies.json');

    return vulns.filter(vuln => {
        const searchableText = `${vuln.title} ${vuln.description} ${vuln.link}`.toLowerCase();
        return filters.some(tech => searchableText.includes(tech.toLowerCase()));
    });
}

async function fetchAllFeeds() {
    const allVulns = [];

    const results = await Promise.allSettled(
        feeds.map(async (feed, index) => {
            if (index > 0) await delay(FEED_DELAY_MS * index);

            try {
                const vulns = await feed.fetch();
                logger.info({ feed: feed.name, count: vulns.length }, 'Feed returned vulnerabilities');
                return { name: feed.name, vulns };
            } catch (error) {
                logger.error({ feed: feed.name, err: error }, 'Feed failed');
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
        logger.info('Starting vulnerability monitoring cycle');

        const allVulns = await fetchAllFeeds();
        logger.info({ total: allVulns.length }, 'Fetched vulnerabilities from all sources');

        // Merge duplicates from multiple feeds
        const mergedVulns = deduplicateAndMerge(allVulns);
        logger.info({ unique: mergedVulns.length }, 'Unique vulnerabilities after merge');

        const relevantVulns = filterByTechnology(mergedVulns);
        if (config.filterSettings?.enabled) {
            logger.info({ remaining: relevantVulns.length }, 'Vulnerabilities after technology filter');
        }

        // Deduplicate against cache (already persisted vulns)
        const newVulns = relevantVulns.filter(vuln => vuln.cveId && !has(vuln.cveId));

        if (newVulns.length === 0) {
            logger.info('No new, relevant vulnerabilities found');
            return;
        }

        logger.info({ count: newVulns.length }, 'New vulnerabilities to report');

        for (const vuln of newVulns) {
            // Generate LLM explanation (non-blocking fallback)
            try {
                const prompt = renderPrompt('explainCve.txt', {
                    cveId: vuln.cveId,
                    title: vuln.title,
                    description: vuln.description,
                    severity: vuln.severity,
                    cvssScore: vuln.cvssScore,
                    exploited: vuln.exploited,
                    technologies: (vuln.affectedTechnologies || []).join(', '),
                });
                const explanation = await llm.complete(prompt);
                if (explanation) {
                    vuln.clientExplanation = explanation;
                }
            } catch (err) {
                logger.warn({ cveId: vuln.cveId, err }, 'LLM explanation failed, using raw description');
            }

            const highlight = vuln.isCritical() || vuln.isExploited();
            await notifySlack(vuln, highlight);
            add(vuln);
        }

        logger.info('Monitoring cycle completed');
    } catch (error) {
        logger.error({ err: error }, 'Error in monitorVulns');
    }
}

// Exported for testing
export { SOURCE_PRIORITY, getPriorityScore, mergeVulnerabilities, deduplicateAndMerge };
export default monitorVulns;
