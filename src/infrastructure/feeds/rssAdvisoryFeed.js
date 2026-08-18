import Parser from 'rss-parser';
import Vulnerability from '../../domain/entities/Vulnerability.js';
import logger from '../logger.js';
import { FEED_TIMEOUT_MS, USER_AGENT, cvssToSeverity, extractCveId, withRetry } from './feedUtils.js';

/**
 * Advisory sources that publish plain RSS.
 *
 * They differ only in URL and in how much of the CVE they spell out, so they
 * share one implementation. Each mints its own advisory identifier and mentions
 * the CVE in prose; items with no CVE anywhere are dropped, since the pipeline
 * has no way to deduplicate or correlate them.
 */

const parser = new Parser({
    timeout: FEED_TIMEOUT_MS,
    headers: { 'User-Agent': USER_AGENT },
});

/** ZDI states the score in prose: "The ZDI has assigned a CVSS rating of 5.4." */
const CVSS_IN_TEXT = /CVSS[^\d]{0,40}(\d{1,2}(?:\.\d)?)/i;

/**
 * Severity word in the headline.
 *
 * The title only, and on word boundaries: advisory bodies are full of prose
 * like "a low-privileged attacker", which has nothing to do with how bad the
 * vulnerability is.
 */
const SEVERITY_WORDS = [
    [/\b(critical|critique)\b/i, 'Critical'],
    [/\b(high|élevée?)\b/i, 'High'],
    [/\b(medium|moderate|moyenne?)\b/i, 'Medium'],
    [/\b(low|faible)\b/i, 'Low'],
];

function severityFor(title, body) {
    const scored = String(body ?? '').match(CVSS_IN_TEXT);
    if (scored) return { severity: cvssToSeverity(scored[1]), score: Number(scored[1]) };

    for (const [pattern, severity] of SEVERITY_WORDS) {
        if (pattern.test(String(title ?? ''))) return { severity, score: null };
    }

    return { severity: 'Unknown', score: null };
}

/**
 * @param {{ name: string, url: string, label: string }} descriptor
 * @returns {() => Promise<Vulnerability[]>}
 */
export function createRssAdvisoryFeed({ name, url, label }) {
    return async function fetch() {
        return withRetry(`${name}Feed`, async () => {
            logger.info({ feed: name }, `Fetching ${label} advisories`);

            const feed = await parser.parseURL(url);
            const items = feed?.items ?? [];

            if (items.length === 0) {
                logger.info({ feed: name }, 'No items in advisory feed');
                return [];
            }

            const vulns = [];

            for (const item of items) {
                const body = item.contentSnippet || item.content || item.summary || '';
                const cveId = extractCveId(item.title, body);
                if (!cveId) continue;

                const { severity, score } = severityFor(item.title, body);

                vulns.push(
                    new Vulnerability({
                        cveId,
                        title: item.title ?? cveId,
                        description: body || 'No description available.',
                        publishedDate: item.isoDate ?? item.pubDate ?? null,
                        type: 'Unknown',
                        severity,
                        source: name,
                        link: item.link,
                        exploited: false,
                        cvssScore: score,
                    })
                );
            }

            logger.info(
                { feed: name, count: vulns.length, items: items.length },
                'Successfully parsed advisory feed'
            );
            return vulns;
        });
    };
}
