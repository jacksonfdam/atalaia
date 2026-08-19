// src/application/monitorVulns.js

import Vulnerability from '../domain/entities/Vulnerability.js';
// Which sources exist, and which are enabled, lives in the registry so that
// this cycle and the /feeds/health endpoint can never disagree.
import { enabledFeeds } from '../infrastructure/feeds/feedRegistry.js';
import { readFileSync } from 'fs';
import path from 'path';
import notifySlack from '../infrastructure/notifySlack.js';
import { notifyTeams } from '../infrastructure/notifiers/notifyTeams.js';
import { notifyTelegram } from '../infrastructure/notifiers/notifyTelegram.js';
import { notifyDiscord } from '../infrastructure/notifiers/notifyDiscord.js';
import { has, add, markNotified } from '../infrastructure/cache/postgresCache.js';
import config from '../infrastructure/config.js';
import logger from '../infrastructure/logger.js';
import { createLLMAdapter, renderPrompt } from '../infrastructure/llm/llmAdapter.js';
import { correlateVulnerability } from './correlateVulnerability.js';
import { notifyRepositorySubscribers } from './notifySubscribers.js';
import { getAllUniqueDependencies, listRepositories } from '../infrastructure/cache/repositoryStore.js';

const TECH_CONFIG_PATH = path.resolve('config/technologies.json');

const FEED_DELAY_MS = parseInt(process.env.FEED_DELAY_MS, 10) || 2000;

/**
 * How recently an advisory must have been published to be worth an alert.
 *
 * Only NVD asks its source for a window; CISA serves the whole KEV catalogue
 * every fetch, OpenCVE pages through its whole list, Snyk and GHSA return a
 * listing. Cutting by date here rather than per feed means one rule, applied to
 * every source including the ones added later.
 *
 * Set to 0 to disable the cutoff.
 */
const MAX_AGE_DAYS = Number.parseInt(process.env.VULN_MAX_AGE_DAYS, 10) || 7;

/**
 * Alerts one cycle may send.
 *
 * Telegram accepts about twenty messages a minute to a group and answers the
 * rest with 429; a first run against an empty database had several hundred to
 * send and sent them back to back. Past the cap the findings are still
 * recorded — the console shows them, no message goes out.
 */
const MAX_ALERTS_PER_CYCLE = Number.parseInt(process.env.MAX_ALERTS_PER_CYCLE, 10) || 20;

/** Spacing between alerts, so a full cycle stays under the same rate limits. */
const ALERT_DELAY_MS = Number.parseInt(process.env.ALERT_DELAY_MS, 10) || 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Worst first, so a cap that bites drops the least urgent findings. */
const SEVERITY_RANK = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, UNKNOWN: 4 };

/**
 * Source priority: lower index = higher priority.
 * When the same CVE appears in multiple feeds, the highest-priority source wins
 * for severity, description, and source fields.
 */
const SOURCE_PRIORITY = [
    'nvd',
    'cisa',
    'mitre',
    'opencve',
    'ghsa',
    'euvd',
    'redhat',
    'ubuntu',
    'snyk',
    'vuldb',
    'zdi',
    'certeu',
    'certfr',
    'cvedetails',
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

/**
 * Split by publication date: recent enough to alert on, too old, or undated.
 *
 * Undated is its own outcome rather than being folded into either side. The
 * feeds used to stamp a missing date with `new Date()`, which made every
 * undated advisory look like this morning's; counting them separately is what
 * makes a source that stopped publishing dates visible instead of silent.
 *
 * @param {Vulnerability[]} vulns
 * @param {number} maxAgeDays 0 disables the cutoff
 * @returns {{ fresh: Vulnerability[], stale: Vulnerability[], undated: Vulnerability[] }}
 */
function partitionByAge(vulns, maxAgeDays = MAX_AGE_DAYS) {
    if (maxAgeDays <= 0) return { fresh: vulns, stale: [], undated: [] };

    const cutoff = Date.now() - maxAgeDays * DAY_MS;
    const fresh = [];
    const stale = [];
    const undated = [];

    for (const vuln of vulns) {
        // The entity normalises whatever the feed gave into a Date or null.
        if (!(vuln.publishedDate instanceof Date)) {
            undated.push(vuln);
        } else if (vuln.publishedDate.getTime() >= cutoff) {
            fresh.push(vuln);
        } else {
            stale.push(vuln);
        }
    }

    return { fresh, stale, undated };
}

/** How many of each source, for a log line that names the feed to fix. */
function countBySource(vulns) {
    const counts = {};
    for (const vuln of vulns) counts[vuln.source ?? 'unknown'] = (counts[vuln.source ?? 'unknown'] ?? 0) + 1;
    return counts;
}

/**
 * Order for the per-cycle cap: exploited, then severity, then score, then
 * newest. What gets cut is the bottom of that list, not an arbitrary tail.
 */
function byAlertPriority(a, b) {
    if (a.exploited !== b.exploited) return a.exploited ? -1 : 1;

    const rank = (SEVERITY_RANK[a.severity] ?? 4) - (SEVERITY_RANK[b.severity] ?? 4);
    if (rank !== 0) return rank;

    const score = (b.cvssScore ?? 0) - (a.cvssScore ?? 0);
    if (score !== 0) return score;

    return (b.publishedDate?.getTime() ?? 0) - (a.publishedDate?.getTime() ?? 0);
}

function loadTechFilters() {
    try {
        const data = readFileSync(TECH_CONFIG_PATH, 'utf-8');
        return JSON.parse(data);
    } catch {
        return null;
    }
}

/**
 * Build a dynamic technology filter from scanned repository dependencies.
 * Returns null if no repos are configured or autoFilterFromDeps is disabled.
 * @returns {string[] | null}
 */
async function loadDynamicTechFilters() {
    if (!config.repositories?.autoFilterFromDeps) return null;

    try {
        const repos = await listRepositories();
        if (repos.length === 0) return null;

        const deps = await getAllUniqueDependencies();
        if (deps.length === 0) return null;

        const filters = new Set();
        for (const dep of deps) {
            filters.add(dep.name.toLowerCase());
            if (dep.opencve_vendor) filters.add(dep.opencve_vendor.toLowerCase());
            if (dep.opencve_product) filters.add(dep.opencve_product.toLowerCase());
        }

        return [...filters];
    } catch {
        return null;
    }
}

async function filterByTechnology(vulns) {
    // Priority 1: Dynamic filter from scanned repos
    const dynamicFilters = await loadDynamicTechFilters();
    if (dynamicFilters && dynamicFilters.length > 0) {
        logger.info({ count: dynamicFilters.length }, 'Filtering from scanned repository dependencies');
        return vulns.filter(vuln => {
            const text = `${vuln.title} ${vuln.description} ${vuln.link}`.toLowerCase();
            return dynamicFilters.some(tech => text.includes(tech));
        });
    }

    // Priority 2: Static technologies.json
    const techConfig = loadTechFilters();
    const filters = techConfig?.filters;

    if (!filters || filters.length === 0) {
        // Priority 3: config.json filterSettings
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
    const feeds = await enabledFeeds();

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

        const relevantVulns = await filterByTechnology(mergedVulns);
        if (config.filterSettings?.enabled) {
            logger.info({ remaining: relevantVulns.length }, 'Vulnerabilities after technology filter');
        }

        // Age before identity: the KEV catalogue alone is well over a thousand
        // rows every fetch, and asking the database about each of them to then
        // discard it on date is a thousand queries for nothing.
        const { fresh, stale, undated } = partitionByAge(relevantVulns);

        if (stale.length > 0) {
            logger.info(
                { discarded: stale.length, maxAgeDays: MAX_AGE_DAYS, bySource: countBySource(stale) },
                'Discarded vulnerabilities published outside the age window'
            );
        }
        if (undated.length > 0) {
            // Not an aside: a feed that stopped publishing dates loses every
            // one of its findings here, and the source name is how to tell.
            logger.warn(
                { discarded: undated.length, bySource: countBySource(undated) },
                'Discarded vulnerabilities with no publication date — the age of these cannot be established'
            );
        }

        // Deduplicate against what is already stored. A loop, not filter():
        // has() is a query, and an async predicate makes filter() keep
        // everything — every CVE would be re-notified on every cycle.
        const newVulns = [];
        for (const vuln of fresh) {
            if (!vuln.cveId) continue;
            if (await has(vuln.cveId)) continue;
            newVulns.push(vuln);
        }

        if (newVulns.length === 0) {
            logger.info('No new, relevant vulnerabilities found');
            return;
        }

        // Worst first, so what the cap cuts is the least urgent.
        const ranked = newVulns.sort(byAlertPriority);
        const toAlert = ranked.slice(0, MAX_ALERTS_PER_CYCLE);
        const recordOnly = ranked.slice(MAX_ALERTS_PER_CYCLE);

        logger.info(
            { count: newVulns.length, alerting: toAlert.length, recordedOnly: recordOnly.length },
            'New vulnerabilities to report'
        );

        if (recordOnly.length > 0) {
            logger.warn(
                { cap: MAX_ALERTS_PER_CYCLE, recordedOnly: recordOnly.length },
                'Past the per-cycle alert cap; the rest are stored without an alert'
            );
        }

        for (const [index, vuln] of toAlert.entries()) {
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
                const llm = await createLLMAdapter();
                const explanation = await llm.complete(prompt);
                if (explanation) {
                    vuln.clientExplanation = explanation;
                }
            } catch (err) {
                logger.warn({ cveId: vuln.cveId, err }, 'LLM explanation failed, using raw description');
            }

            // Correlate with repositories and owners
            let correlation = { affectedRepositories: [], owners: [] };
            try {
                correlation = await correlateVulnerability(vuln);
            } catch (err) {
                logger.warn({ cveId: vuln.cveId, err }, 'Vulnerability correlation failed');
            }

            // Stored before anything is sent. A worker killed halfway through
            // a batch used to leave every unstored finding looking new, and the
            // next cycle announced the lot a second time. The opposite mistake
            // — stored, never announced — is the one that leaves a trace:
            // notified_at stays null.
            await add(vuln);

            const highlight = vuln.isCritical() || vuln.isExploited();
            // Every channel, each deciding for itself whether it is configured.
            await notifySlack(vuln, highlight, correlation);
            await notifyTeams(vuln, highlight, correlation);
            await notifyTelegram(vuln, highlight, correlation);
            await notifyDiscord(vuln, highlight, correlation);

            // And the people who asked about one of these repositories in
            // particular. Immediate, because a CVE in something you ship is not
            // a Monday problem — a dependency that fell behind is, and that one
            // waits for the digest.
            try {
                await notifyRepositorySubscribers(vuln, correlation.affectedRepositories);
            } catch (err) {
                logger.warn({ cveId: vuln.cveId, err }, 'Could not notify repository subscribers');
            }

            await markNotified(vuln.cveId);

            if (index < toAlert.length - 1) await delay(ALERT_DELAY_MS);
        }

        // Everything the cap held back is still a finding; it is the alert that
        // was dropped, not the record.
        for (const vuln of recordOnly) {
            await add(vuln);
        }

        logger.info('Monitoring cycle completed');
    } catch (error) {
        logger.error({ err: error }, 'Error in monitorVulns');
    }
}

// Exported for testing
export {
    SOURCE_PRIORITY,
    getPriorityScore,
    mergeVulnerabilities,
    deduplicateAndMerge,
    partitionByAge,
    byAlertPriority,
};
export default monitorVulns;
