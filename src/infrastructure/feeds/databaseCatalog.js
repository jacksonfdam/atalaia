import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../logger.js';

/**
 * Catalog of public vulnerability databases.
 *
 * The list in config/vulnerability-databases.json is kept verbatim from
 * https://github.com/haxdoggy/vulnerability-databases so it can be refreshed
 * with a plain copy. Everything Atalaia-specific — which entry an adapter reads,
 * why an entry has none — lives here instead of being merged into that file.
 *
 * The catalog is deliberately larger than the set of implemented feeds: an
 * operator needs to see that a database exists and why it is not collected,
 * not have it silently absent.
 */

const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = path.resolve(path.dirname(__filename), '..', '..', '..');
const CATALOG_PATH = path.join(PROJECT_ROOT, 'config/vulnerability-databases.json');

/**
 * Catalog abbreviation -> feed name in the registry.
 * A database with no entry here is listed but not collected.
 */
const ADAPTER_BY_ABBREVIATION = {
    CVE: 'mitre',
    NVD: 'nvd',
    GHSA: 'ghsa',
    'CISA KEV': 'cisa',
    EUVD: 'euvd',
    'CERT-EU': 'certeu',
    'CERT-FR': 'certfr',
    ZDI: 'zdi',
    RHSA: 'redhat',
    USN: 'ubuntu',
    VulnDB: 'vuldb',
    Snyk: 'snyk',
};

/**
 * Why a listed database has no adapter. Absent means "not implemented yet";
 * these are the ones where implementing it would not pay off.
 */
const NO_ADAPTER_REASON = {
    OSV: 'Queried per package rather than as a stream of recent items — it fits dependency correlation, not the monitoring cycle.',
    Vulners: 'Commercial API key required.',
    'Rapid7 VulnDB': 'HTML only, no feed.',
    PacketStorm: 'HTML only, no feed.',
    'Exploit-DB': 'Exploit archive rather than a vulnerability feed; CISA KEV already flags active exploitation.',
    'Tenable CVE': 'HTML only, no feed.',
    OVAL: 'Definition files per distribution, consumed by scanners rather than by an alerting pipeline.',
    OpenVAS: 'Scanner feed (NASL scripts), not a vulnerability list.',
    MSRC: 'CVRF documents are published per month and must be resolved through an index — worth adding, not implemented yet.',
};

let cache = null;

/** @returns {object[]} Raw catalog entries, empty if the file is unreadable. */
function readCatalog() {
    if (cache) return cache;

    try {
        cache = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf-8'));
    } catch (err) {
        logger.error({ err, path: CATALOG_PATH }, 'Failed to load the vulnerability database catalog');
        cache = [];
    }

    return cache;
}

/**
 * The catalog with Atalaia's own annotations.
 *
 * @returns {{ name: string, abbreviation: string, url: string, apiUrl: string|null,
 *             maintainer: string, region: string, category: string, free: boolean,
 *             hasApi: boolean, description: string, feed: string|null,
 *             noAdapterReason: string|null }[]}
 */
export function listCatalog() {
    return readCatalog().map(entry => ({
        name: entry.name,
        abbreviation: entry.abbreviation,
        url: entry.url,
        apiUrl: entry.api_url ?? null,
        maintainer: entry.maintainer,
        region: entry.region,
        category: entry.category,
        free: entry.free === true,
        hasApi: entry.has_api === true,
        description: entry.description,
        feed: ADAPTER_BY_ABBREVIATION[entry.abbreviation] ?? null,
        noAdapterReason: ADAPTER_BY_ABBREVIATION[entry.abbreviation]
            ? null
            : NO_ADAPTER_REASON[entry.abbreviation] ?? null,
    }));
}

/**
 * The catalog entry a feed reads from, so the console can show an operator
 * where a source's data actually comes from.
 *
 * @param {string} feedName
 */
export function catalogEntryForFeed(feedName) {
    return listCatalog().find(entry => entry.feed === feedName) ?? null;
}

/** Exported for tests. */
export function resetCatalogCache() {
    cache = null;
}
