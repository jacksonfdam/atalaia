import { fetch as fetchCisa } from './cisaFeed.js';
import { fetch as fetchSnyk } from './snykFeed.js';
import { fetch as fetchVuldb } from './vuldbFeed.js';
import { fetch as fetchNvd } from './nvdFeed.js';
import { fetch as fetchOpenCVE } from './opencveFeed.js';
import { fetch as fetchGhsa } from './ghsaFeed.js';
import { fetch as fetchEuvd } from './euvdFeed.js';
import { fetch as fetchMitre } from './mitreFeed.js';
import { catalogEntryForFeed } from './databaseCatalog.js';
import { listOverrides, setEnabled, clearOverride } from './feedState.js';

/**
 * Every intelligence source Atalaia can collect from.
 *
 * Single source of truth: the monitoring cycle iterates the enabled entries,
 * and the /feeds/health endpoint probes all of them. Keeping one list means a
 * source can never be monitored but invisible to health checks, or vice versa.
 *
 * `defaultEnabled: false` entries are kept deliberately — an operator needs to
 * see that a source exists and why it is off, not have it silently absent.
 * Whether a source actually runs is `defaultEnabled` unless the operator has
 * overridden it; see feedState.js.
 *
 * @typedef {object} FeedDescriptor
 * @property {string} name          Stable key, matches the `source` column
 * @property {string} label         Human-readable name
 * @property {() => Promise<import('../../domain/entities/Vulnerability.js').default[]>} fetch
 * @property {boolean} defaultEnabled
 * @property {string} [disabledReason]  Why the default is off
 */

/** @type {FeedDescriptor[]} */
const REGISTRY = [
    { name: 'nvd', label: 'NVD', fetch: fetchNvd, defaultEnabled: true },
    { name: 'cisa', label: 'CISA KEV', fetch: fetchCisa, defaultEnabled: true },
    { name: 'opencve', label: 'OpenCVE', fetch: fetchOpenCVE, defaultEnabled: true },
    { name: 'snyk', label: 'Snyk', fetch: fetchSnyk, defaultEnabled: true },
    { name: 'vuldb', label: 'VulDB', fetch: fetchVuldb, defaultEnabled: true },
    { name: 'mitre', label: 'MITRE CVE List', fetch: fetchMitre, defaultEnabled: true },
    { name: 'euvd', label: 'EUVD (ENISA)', fetch: fetchEuvd, defaultEnabled: true },
    {
        name: 'ghsa',
        label: 'GitHub Advisories',
        fetch: fetchGhsa,
        defaultEnabled: true,
        // Not a hard requirement, but an unauthenticated caller gets 60
        // requests/hour per IP and will usually be rate-limited already.
        disabledReason: 'Set GITHUB_TOKEN for a usable rate limit.',
    },
    {
        name: 'redhat',
        label: 'Red Hat Security Data',
        // Imported lazily: the module is otherwise dead weight while disabled.
        fetch: async () => (await import('./redhatFeed.js')).fetch(),
        defaultEnabled: false,
        disabledReason: 'Vendor source. Enable it if you ship Red Hat or CentOS based images.',
    },
    {
        name: 'ubuntu',
        label: 'Ubuntu Security Notices',
        fetch: async () => (await import('./ubuntuFeed.js')).fetch(),
        defaultEnabled: false,
        disabledReason: 'Vendor source. Enable it if you ship Debian or Ubuntu based images.',
    },
    {
        name: 'zdi',
        label: 'Zero Day Initiative',
        fetch: async () => (await import('./zdiFeed.js')).fetch(),
        defaultEnabled: false,
        disabledReason:
            'Advisories are often published before the vendor patch exists, so most items are not actionable yet.',
    },
    {
        name: 'certeu',
        label: 'CERT-EU',
        fetch: async () => (await import('./certEuFeed.js')).fetch(),
        defaultEnabled: false,
        disabledReason: 'Regional source, largely redundant with NVD. Enable it if you report to EU institutions.',
    },
    {
        name: 'certfr',
        label: 'CERT-FR (ANSSI)',
        fetch: async () => (await import('./certFrFeed.js')).fetch(),
        defaultEnabled: false,
        disabledReason: 'Regional source; advisories are in French and rarely name the CVE in the title.',
    },
    {
        name: 'cvedetails',
        label: 'CVE Details',
        fetch: async () => (await import('./cveDetailsFeed.js')).fetch(),
        defaultEnabled: false,
        disabledReason:
            'cvedetails.com returns 403 to scraper requests (bot protection). Its data is largely redundant with NVD/CISA/OpenCVE, which rank higher in SOURCE_PRIORITY.',
    },
];

/**
 * The registry with the operator's overrides applied.
 * @returns {(FeedDescriptor & { enabled: boolean, overridden: boolean, catalog: object|null })[]}
 */
export function listFeeds() {
    const overrides = listOverrides();

    return REGISTRY.map(feed => {
        const override = overrides.get(feed.name);

        return {
            ...feed,
            enabled: override ? override.enabled : feed.defaultEnabled,
            overridden: Boolean(override),
            updatedAt: override?.updatedAt ?? null,
            updatedBy: override?.updatedBy ?? null,
            catalog: catalogEntryForFeed(feed.name),
        };
    });
}

/** Feeds the monitoring cycle actually runs. */
export function enabledFeeds() {
    return listFeeds().filter(feed => feed.enabled);
}

/** @returns {ReturnType<typeof listFeeds>[number] | undefined} */
export function getFeed(name) {
    return listFeeds().find(feed => feed.name === name?.toLowerCase());
}

/**
 * Turn a source on or off. Persisted, so it survives a restart.
 *
 * @param {string} name
 * @param {boolean} enabled
 * @param {string} [changedBy]
 * @returns {ReturnType<typeof listFeeds>[number]}
 */
export function setFeedEnabled(name, enabled, changedBy) {
    const feed = getFeed(name);
    if (!feed) throw new Error(`Unknown feed: ${name}`);

    setEnabled(feed.name, enabled, changedBy);
    return getFeed(feed.name);
}

/** Drop the override so the source follows the registry default again. */
export function resetFeed(name) {
    const feed = getFeed(name);
    if (!feed) throw new Error(`Unknown feed: ${name}`);

    clearOverride(feed.name);
    return getFeed(feed.name);
}
