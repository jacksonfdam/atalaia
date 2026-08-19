import axios from 'axios';
import Vulnerability from '../../domain/entities/Vulnerability.js';
import logger from '../logger.js';
import { FEED_TIMEOUT_MS, USER_AGENT, withRetry } from './feedUtils.js';

/**
 * Debian security advisories.
 *
 * Debian is the obvious gap among the distribution trackers: it is what most of
 * the images in a Dockerfile are built on, and `Ecosystem.DOCKER` dependencies
 * are already correlated against.
 *
 * **Not `tracker/data/json`.** That endpoint is the natural first choice and it
 * is the wrong one. It is a status database rather than a feed: 4061 packages,
 * every CVE each has ever had back to 2012, 85.9 MB, 15.2 seconds — already at
 * the default FEED_TIMEOUT_MS — and, decisively, **no publication date
 * anywhere**. The monitoring cycle discards an advisory whose age cannot be
 * established, so every single item would be dropped and warned about. A feed
 * that costs 86 MB an hour to contribute nothing is worse than no feed.
 *
 * The DSA and DLA advisory lists are what a feed wants: dated, newest first,
 * 1.1 MB and 0.8 MB, under two seconds each.
 *
 *     [18 Aug 2026] DSA-6450-1 srt - security update
 *         {CVE-2026-55868 CVE-2026-55869}
 *         [trixie] - srt 1.5.4-1+deb13u1
 */

const LISTS = [
    { kind: 'DSA', url: 'https://salsa.debian.org/security-tracker-team/security-tracker/-/raw/master/data/DSA/list' },
    // Long Term Support, for the release Debian no longer calls stable. A fleet
    // running an older base image is exactly who needs these.
    { kind: 'DLA', url: 'https://salsa.debian.org/security-tracker-team/security-tracker/-/raw/master/data/DLA/list' },
];

/**
 * Advisories read per list, newest first.
 *
 * Deliberately small, for the same reason USN_LIMIT is: one advisory can name
 * hundreds of CVEs. A single kernel DLA in the current list carries just over
 * three hundred, so ten advisories already expand into thousands of rows.
 */
const LIMIT = parseInt(process.env.DEBIAN_LIMIT, 10) || 10;

const HEADER = /^\[(\d{1,2}) (\w{3}) (\d{4})\]\s+(D[SL]A-[\w.-]+)\s+(\S+)\s*-?\s*(.*)$/;
const CVE_BLOCK = /\{([^}]*)\}/;

const MONTHS = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

/**
 * `18 Aug 2026` as an ISO date the entity can normalise.
 *
 * Parsed rather than handed to `new Date`: the three-letter month is
 * locale-dependent there, and a date this feed cannot read has to come back as
 * nothing rather than as today.
 *
 * @param {string} day @param {string} month @param {string} year
 * @returns {string|null}
 */
function isoDate(day, month, year) {
    const numeric = MONTHS[month.toLowerCase()];
    return numeric ? `${year}-${numeric}-${day.padStart(2, '0')}T00:00:00Z` : null;
}

/**
 * The advisories in one list, newest first, up to `limit`.
 *
 * @param {string} text
 * @param {number} limit
 * @returns {{ id: string, packageName: string, summary: string, published: string|null, cveIds: string[] }[]}
 */
export function parseAdvisoryList(text, limit = LIMIT) {
    const advisories = [];
    let current = null;

    for (const line of text.split('\n')) {
        const header = line.match(HEADER);

        if (header) {
            if (advisories.length >= limit) break;

            const [, day, month, year, id, packageName, summary] = header;
            current = {
                id,
                packageName,
                summary: summary.trim(),
                published: isoDate(day, month, year),
                cveIds: [],
            };
            advisories.push(current);
            continue;
        }

        if (!current) continue;

        // The indented block holds the CVE list, the fixed version per suite,
        // and sometimes a NOTE. Only the braces matter here.
        const block = line.match(CVE_BLOCK);
        if (block) {
            current.cveIds.push(...(block[1].match(/CVE-\d{4}-\d{4,}/g) ?? []));
        }
    }

    return advisories;
}

/**
 * @returns {Promise<Vulnerability[]>}
 */
export async function fetch() {
    return withRetry('debianFeed', async () => {
        logger.info('Fetching Debian security advisories');

        const vulns = [];
        const byName = new Map();
        let advisoryCount = 0;

        // Both lists, one at a time. A failure in either throws out of here and
        // the cycle's Promise.allSettled keeps the other sources going.
        for (const list of LISTS) {
            const { data } = await axios.get(list.url, {
                timeout: FEED_TIMEOUT_MS,
                headers: { 'User-Agent': USER_AGENT, Accept: 'text/plain' },
                // The lists are plain text; without this axios guesses at JSON
                // for a body that starts with a bracket.
                responseType: 'text',
                transformResponse: [body => body],
            });

            const advisories = parseAdvisoryList(String(data));
            advisoryCount += advisories.length;

            for (const advisory of advisories) {
                // An advisory with no CVE reference cannot be deduplicated
                // against the other sources, so it is dropped rather than stored
                // as an orphan. Same rule as ubuntuFeed.
                for (const cveId of advisory.cveIds) {
                    // The kernel appears in a DSA and a DLA in the same week; the
                    // first, newer one wins.
                    if (byName.has(cveId)) continue;
                    byName.set(cveId, true);

                    vulns.push(
                        new Vulnerability({
                            cveId,
                            title: `${advisory.id} ${advisory.packageName} — ${advisory.summary}`,
                            description: `Debian ${list.kind} for ${advisory.packageName}: ${advisory.summary}.`,
                            publishedDate: advisory.published,
                            type: 'Unknown',
                            // The advisory lists state a package and a date, never
                            // a severity. The urgency in tracker/data/json is the
                            // only place Debian publishes one, and it is not a
                            // severity either: `unimportant` there does not mean
                            // low, it means Debian judged the issue not worth a
                            // security update at all. Mapping it onto LOW would
                            // turn a decision not to fix into a finding.
                            severity: 'Unknown',
                            source: 'debian',
                            link: `https://security-tracker.debian.org/tracker/${advisory.id}`,
                            exploited: false,
                            affectedTechnologies: [advisory.packageName],
                        })
                    );
                }
            }
        }

        if (vulns.length === 0) {
            logger.info('No advisories returned by Debian');
            return [];
        }

        logger.info(
            { count: vulns.length, advisories: advisoryCount },
            'Successfully parsed Debian advisories'
        );
        return vulns;
    });
}
