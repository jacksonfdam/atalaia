import { fetch as fetchCisa } from './cisaFeed.js';
import { fetch as fetchSnyk } from './snykFeed.js';
import { fetch as fetchVuldb } from './vuldbFeed.js';
import { fetch as fetchNvd } from './nvdFeed.js';
import { fetch as fetchOpenCVE } from './opencveFeed.js';

/**
 * Every intelligence source Atalaia knows about.
 *
 * Single source of truth: the monitoring cycle iterates the enabled entries,
 * and the /feeds/health endpoint probes all of them. Keeping one list means a
 * source can never be monitored but invisible to health checks, or vice versa.
 *
 * `enabled: false` entries are kept deliberately — an operator needs to see
 * that a source exists and why it is off, not have it silently absent.
 *
 * @typedef {object} FeedDescriptor
 * @property {string} name          Stable key, matches the `source` column
 * @property {string} label         Human-readable name
 * @property {() => Promise<import('../../domain/entities/Vulnerability.js').default[]>} fetch
 * @property {boolean} enabled      Whether the monitoring cycle runs it
 * @property {string} [disabledReason]
 */

/** @type {FeedDescriptor[]} */
export const FEEDS = [
    { name: 'nvd', label: 'NVD', fetch: fetchNvd, enabled: true },
    { name: 'cisa', label: 'CISA KEV', fetch: fetchCisa, enabled: true },
    { name: 'opencve', label: 'OpenCVE', fetch: fetchOpenCVE, enabled: true },
    { name: 'snyk', label: 'Snyk', fetch: fetchSnyk, enabled: true },
    { name: 'vuldb', label: 'VulDB', fetch: fetchVuldb, enabled: true },
    {
        name: 'cvedetails',
        label: 'CVE Details',
        // Imported lazily: the module is otherwise dead weight while disabled.
        fetch: async () => (await import('./cveDetailsFeed.js')).fetch(),
        enabled: false,
        disabledReason:
            'cvedetails.com returns 403 to scraper requests (bot protection). Its data is largely redundant with NVD/CISA/OpenCVE, which rank higher in SOURCE_PRIORITY.',
    },
];

/** Feeds the monitoring cycle actually runs. */
export function enabledFeeds() {
    return FEEDS.filter(feed => feed.enabled);
}

/** @returns {FeedDescriptor|undefined} */
export function getFeed(name) {
    return FEEDS.find(feed => feed.name === name?.toLowerCase());
}
