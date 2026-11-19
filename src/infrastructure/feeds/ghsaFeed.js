import axios from 'axios';
import Vulnerability from '../../domain/entities/Vulnerability.js';
import logger from '../logger.js';
import { FEED_TIMEOUT_MS, USER_AGENT, withRetry } from './feedUtils.js';
import { fromGithubEcosystem } from './advisoryEcosystems.js';

const GHSA_API_URL = 'https://api.github.com/advisories';
const PER_PAGE = 100;

/**
 * The per-package version ranges of one advisory.
 *
 * GitHub states, for every package, `vulnerable_version_range` and
 * `first_patched_version`. A package in an ecosystem Atalaia does not scan, or
 * one with no range, is skipped: a row nothing can compare is not evidence.
 *
 * @returns {{ source: 'ghsa', ecosystem: string, name: string, vulnerableRange: string, firstPatched: string|null }[]}
 */
export function affectedPackagesOf(item) {
    return (item.vulnerabilities ?? [])
        .map(entry => {
            const ecosystem = fromGithubEcosystem(entry.package?.ecosystem);
            const name = entry.package?.name;
            const range = entry.vulnerable_version_range;
            if (!ecosystem || !name || !range) return null;

            const patched = entry.first_patched_version;

            return {
                source: 'ghsa',
                ecosystem,
                name: String(name).toLowerCase(),
                vulnerableRange: String(range),
                // The API gives a string; older shapes wrap it in { identifier }.
                firstPatched: (typeof patched === 'string' ? patched : patched?.identifier) ?? null,
            };
        })
        .filter(Boolean);
}

/**
 * GitHub Advisory Database.
 *
 * Read-only: a single GET against the public advisories endpoint. The token is
 * optional but effectively required in practice — unauthenticated callers get
 * 60 requests/hour per IP and are usually already over it.
 *
 * @returns {Promise<Vulnerability[]>}
 */
export async function fetch() {
    const token = process.env.GITHUB_TOKEN;

    return withRetry('ghsaFeed', async () => {
        logger.info('Fetching GitHub Advisory Database');

        const { data } = await axios.get(GHSA_API_URL, {
            timeout: FEED_TIMEOUT_MS,
            headers: {
                Accept: 'application/vnd.github+json',
                'User-Agent': USER_AGENT,
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            params: { per_page: PER_PAGE, sort: 'published', direction: 'desc' },
        });

        if (!Array.isArray(data) || data.length === 0) {
            logger.info('No advisories returned by GHSA');
            return [];
        }

        const vulns = data.map(item => {
            // Packages are the reason this source is worth collecting: they are
            // what the technology filter matches against.
            const packages = (item.vulnerabilities ?? [])
                .map(entry => entry.package?.name)
                .filter(Boolean);

            const ecosystems = (item.vulnerabilities ?? [])
                .map(entry => entry.package?.ecosystem)
                .filter(Boolean);

            return new Vulnerability({
                cveId: item.cve_id ?? null,
                title: item.summary || item.ghsa_id,
                description: item.description || item.summary || 'No description available.',
                publishedDate: item.published_at,
                type: item.cwes?.[0]?.name ?? 'Unknown',
                severity: item.severity ?? 'Unknown',
                source: 'ghsa',
                link: item.html_url || item.url,
                // GitHub does not publish exploitation status here; CISA KEV does.
                exploited: false,
                cvssScore: item.cvss?.score ?? item.cvss_severities?.cvss_v4?.score ?? null,
                affectedTechnologies: [...new Set([...packages, ...ecosystems])],
                affectedPackages: affectedPackagesOf(item),
            });
        });

        logger.info({ count: vulns.length }, 'Successfully parsed GHSA advisories');
        return vulns;
    });
}
