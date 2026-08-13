import axios from 'axios';
import Vulnerability from '../../domain/entities/Vulnerability.js';
import logger from '../logger.js';
import { FEED_TIMEOUT_MS, USER_AGENT, cvssToSeverity, extractCveId, withRetry } from './feedUtils.js';

// euvd.enisa.europa.eu serves the web app; the API lives on its own host.
const EUVD_API_URL = 'https://euvdservices.enisa.europa.eu/api/lastvulnerabilities';

/** EUVD publishes no title, so the first sentence of the description stands in. */
function titleFrom(description, id) {
    const text = String(description ?? '').trim();
    if (!text) return id;

    const firstSentence = text.split(/(?<=\.)\s|\n/)[0];
    return firstSentence.length > 160 ? `${firstSentence.slice(0, 157)}…` : firstSentence;
}

/** Dates arrive as "Apr 9, 2026, 9:41:15 AM" rather than ISO. */
function toIso(value) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

/**
 * ENISA European Union Vulnerability Database.
 * @returns {Promise<Vulnerability[]>}
 */
export async function fetch() {
    return withRetry('euvdFeed', async () => {
        logger.info('Fetching EUVD feed');

        const { data } = await axios.get(EUVD_API_URL, {
            timeout: FEED_TIMEOUT_MS,
            headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        });

        if (!Array.isArray(data) || data.length === 0) {
            logger.info('No vulnerabilities returned by EUVD');
            return [];
        }

        const vulns = data.map(item => {
            const vendors = (item.enisaIdVendor ?? [])
                .map(entry => entry.vendor?.name)
                .filter(Boolean);

            return new Vulnerability({
                // EUVD mints its own identifier and lists the CVE among aliases;
                // the CVE is what the rest of the pipeline deduplicates on.
                cveId: extractCveId(item.aliases, item.id),
                title: titleFrom(item.description, item.id),
                description: item.description || 'No description available.',
                publishedDate: toIso(item.datePublished),
                type: 'Unknown',
                severity: cvssToSeverity(item.baseScore),
                source: 'euvd',
                link: `https://euvd.enisa.europa.eu/vulnerability/${item.id}`,
                exploited: false,
                cvssScore: item.baseScore ?? null,
                affectedTechnologies: vendors,
            });
        });

        logger.info({ count: vulns.length }, 'Successfully parsed EUVD vulnerabilities');
        return vulns;
    });
}
