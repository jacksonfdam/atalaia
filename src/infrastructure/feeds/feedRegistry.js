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
 * @property {() => Promise<object>} load     Imports the adapter module
 * @property {boolean} defaultEnabled
 * @property {string} [disabledReason]  Why the default is off
 */

/** @type {FeedDescriptor[]} */
const REGISTRY = [
    { name: 'nvd', label: 'NVD', load: () => import('./nvdFeed.js'), defaultEnabled: true },
    { name: 'cisa', label: 'CISA KEV', load: () => import('./cisaFeed.js'), defaultEnabled: true },
    { name: 'opencve', label: 'OpenCVE', load: () => import('./opencveFeed.js'), defaultEnabled: true },
    { name: 'snyk', label: 'Snyk', load: () => import('./snykFeed.js'), defaultEnabled: true },
    { name: 'vuldb', label: 'VulDB', load: () => import('./vuldbFeed.js'), defaultEnabled: true },
    { name: 'mitre', label: 'MITRE CVE List', load: () => import('./mitreFeed.js'), defaultEnabled: true },
    { name: 'euvd', label: 'EUVD (ENISA)', load: () => import('./euvdFeed.js'), defaultEnabled: true },
    {
        name: 'ghsa',
        label: 'GitHub Advisories',
        load: () => import('./ghsaFeed.js'),
        defaultEnabled: true,
        // Not a hard requirement, but an unauthenticated caller gets 60
        // requests/hour per IP and will usually be rate-limited already.
        disabledReason: 'Set GITHUB_TOKEN for a usable rate limit.',
    },
    {
        name: 'redhat',
        label: 'Red Hat Security Data',
        load: () => import('./redhatFeed.js'),
        defaultEnabled: false,
        disabledReason: 'Vendor source. Enable it if you ship Red Hat or CentOS based images.',
    },
    {
        name: 'ubuntu',
        label: 'Ubuntu Security Notices',
        load: () => import('./ubuntuFeed.js'),
        defaultEnabled: false,
        disabledReason: 'Vendor source. Enable it if you ship Debian or Ubuntu based images.',
    },
    {
        name: 'debian',
        label: 'Debian Security Advisories',
        load: () => import('./debianFeed.js'),
        defaultEnabled: false,
        disabledReason: 'Vendor source. Enable it if you ship Debian based images — which most images are.',
    },
    {
        name: 'zdi',
        label: 'Zero Day Initiative',
        load: () => import('./zdiFeed.js'),
        defaultEnabled: false,
        disabledReason:
            'Advisories are often published before the vendor patch exists, so most items are not actionable yet.',
    },
    {
        name: 'certeu',
        label: 'CERT-EU',
        load: () => import('./certEuFeed.js'),
        defaultEnabled: false,
        disabledReason: 'Regional source, largely redundant with NVD. Enable it if you report to EU institutions.',
    },
    {
        name: 'certfr',
        label: 'CERT-FR (ANSSI)',
        load: () => import('./certFrFeed.js'),
        defaultEnabled: false,
        disabledReason: 'Regional source; advisories are in French and rarely name the CVE in the title.',
    },
    {
        name: 'cvedetails',
        label: 'CVE Details',
        load: () => import('./cveDetailsFeed.js'),
        defaultEnabled: false,
        disabledReason:
            'cvedetails.com returns 403 to scraper requests (bot protection). Its data is largely redundant with NVD/CISA/OpenCVE, which rank higher in SOURCE_PRIORITY.',
    },
];

/**
 * Turn a descriptor into something callable.
 *
 * The module is imported on use rather than at boot: most sources are off, and
 * an adapter nobody calls is dead weight — the scrapers pull cheerio in with
 * them. Both hooks go through the same import, so a source can never be
 * fetchable but unaskable about its own configuration.
 *
 * A source that needs credentials or a URL says so itself, by exporting
 * `unconfiguredReason()`. Anything else is configured by definition.
 */
function bind(feed) {
    return {
        ...feed,
        fetch: async () => (await feed.load()).fetch(),
        unconfiguredReason: async () => {
            const module = await feed.load();
            return module.unconfiguredReason ? module.unconfiguredReason() : null;
        },
    };
}

/**
 * The registry with the operator's overrides applied.
 * @returns {(FeedDescriptor & { enabled: boolean, overridden: boolean, catalog: object|null })[]}
 */
export async function listFeeds() {
    const overrides = await listOverrides();

    return REGISTRY.map(feed => {
        const override = overrides.get(feed.name);

        return {
            ...bind(feed),
            enabled: override ? override.enabled : feed.defaultEnabled,
            overridden: Boolean(override),
            updatedAt: override?.updatedAt ?? null,
            updatedBy: override?.updatedBy ?? null,
            catalog: catalogEntryForFeed(feed.name),
        };
    });
}

/** Feeds the monitoring cycle actually runs. */
export async function enabledFeeds() {
    return (await listFeeds()).filter(feed => feed.enabled);
}

/** @returns {ReturnType<typeof listFeeds>[number] | undefined} */
export async function getFeed(name) {
    return (await listFeeds()).find(feed => feed.name === name?.toLowerCase());
}

/**
 * Turn a source on or off. Persisted, so it survives a restart.
 *
 * @param {string} name
 * @param {boolean} enabled
 * @param {string} [changedBy]
 * @returns {ReturnType<typeof listFeeds>[number]}
 */
export async function setFeedEnabled(name, enabled, changedBy) {
    const feed = await getFeed(name);
    if (!feed) throw new Error(`Unknown feed: ${name}`);

    await setEnabled(feed.name, enabled, changedBy);
    return await getFeed(feed.name);
}

/** Drop the override so the source follows the registry default again. */
export async function resetFeed(name) {
    const feed = await getFeed(name);
    if (!feed) throw new Error(`Unknown feed: ${name}`);

    await clearOverride(feed.name);
    return await getFeed(feed.name);
}
