import { FEEDS } from '../infrastructure/feeds/feedRegistry.js';
import logger from '../infrastructure/logger.js';

const CACHE_TTL_MS = parseInt(process.env.FEED_HEALTH_TTL_MS, 10) || 60_000;

/**
 * Probing every source costs several seconds of real network time (Snyk alone
 * takes ~4s), so results are cached. The console polls this endpoint on every
 * page load and must not trigger a fresh sweep each time.
 */
let cache = null;

/**
 * Classify a probe result. A feed that answers with zero items is not an error
 * in the transport sense, but it is a broken source from the operator's point
 * of view — which is exactly the state the Snyk scraper is in today.
 */
function classify(feed, vulns, error) {
    if (error) return { status: 'ERROR', detail: error.message };
    if (!feed.enabled) return { status: 'DISABLED', detail: feed.disabledReason ?? null };
    if (vulns.length === 0) {
        return {
            status: 'EMPTY',
            detail: 'Source responded but returned no vulnerabilities. Either it needs credentials, or its response shape changed.',
        };
    }
    return { status: 'OK', detail: null };
}

async function probe(feed) {
    const startedAt = Date.now();
    let vulns = [];
    let error = null;

    try {
        vulns = (await feed.fetch()) ?? [];
    } catch (err) {
        error = err;
        logger.warn({ feed: feed.name, err }, 'Feed health probe failed');
    }

    const severities = {};
    let withCvss = 0;
    for (const vuln of vulns) {
        const key = vuln.severity || 'UNKNOWN';
        severities[key] = (severities[key] || 0) + 1;
        if (vuln.cvssScore != null && vuln.cvssScore !== '') withCvss += 1;
    }

    const { status, detail } = classify(feed, vulns, error);

    return {
        name: feed.name,
        label: feed.label,
        enabled: feed.enabled,
        status,
        detail,
        count: vulns.length,
        // A source can return plenty of rows and still be useless for triage if
        // none carry a score — VulDB is the live example. Surfacing the ratio
        // makes that visible instead of hiding it behind a healthy row count.
        withCvss,
        severities,
        latencyMs: Date.now() - startedAt,
    };
}

/**
 * Probe every known feed and summarise its usefulness.
 *
 * @param {{ force?: boolean }} [options]
 * @returns {Promise<{ checkedAt: string, cached: boolean, feeds: object[] }>}
 */
export async function checkFeedHealth({ force = false } = {}) {
    if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) {
        return { ...cache.value, cached: true };
    }

    // Disabled feeds are reported without being called: probing a source we
    // deliberately turned off would just produce a misleading error row.
    const results = await Promise.all(
        FEEDS.map(feed =>
            feed.enabled
                ? probe(feed)
                : Promise.resolve({
                      name: feed.name,
                      label: feed.label,
                      enabled: false,
                      status: 'DISABLED',
                      detail: feed.disabledReason ?? null,
                      count: 0,
                      withCvss: 0,
                      severities: {},
                      latencyMs: 0,
                  })
        )
    );

    const value = { checkedAt: new Date().toISOString(), feeds: results };
    cache = { at: Date.now(), value };
    return { ...value, cached: false };
}

/** Exported for tests. */
export function resetFeedHealthCache() {
    cache = null;
}
