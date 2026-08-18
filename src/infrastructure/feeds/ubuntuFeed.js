import axios from 'axios';
import Vulnerability from '../../domain/entities/Vulnerability.js';
import logger from '../logger.js';
import { FEED_TIMEOUT_MS, USER_AGENT, withRetry } from './feedUtils.js';

const USN_API_URL = 'https://ubuntu.com/security/notices.json';
// Deliberately small: a single kernel notice can reference several hundred
// CVEs, so 10 notices already expand into upwards of a thousand rows.
const LIMIT = parseInt(process.env.USN_LIMIT, 10) || 10;

/**
 * Ubuntu Security Notices.
 *
 * A notice usually covers several CVEs at once. One vulnerability is emitted
 * per CVE rather than per notice, because the CVE is the identity the rest of
 * the pipeline deduplicates and correlates on.
 *
 * @returns {Promise<Vulnerability[]>}
 */
export async function fetch() {
    return withRetry('ubuntuFeed', async () => {
        logger.info('Fetching Ubuntu Security Notices');

        const { data } = await axios.get(USN_API_URL, {
            timeout: FEED_TIMEOUT_MS,
            headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
            params: { limit: LIMIT },
        });

        const notices = data?.notices ?? [];
        if (notices.length === 0) {
            logger.info('No notices returned by Ubuntu');
            return [];
        }

        const vulns = [];

        for (const notice of notices) {
            const cveIds = notice.cves_ids?.length
                ? notice.cves_ids
                : (notice.cves ?? []).map(cve => cve.id).filter(Boolean);

            const packages = [
                ...new Set((notice.release_packages ? Object.values(notice.release_packages) : [])
                    .flat()
                    .map(entry => entry.name)
                    .filter(Boolean)),
            ];

            // A notice with no CVE reference cannot be deduplicated against the
            // other sources, so it is dropped rather than stored as an orphan.
            for (const cveId of cveIds) {
                vulns.push(
                    new Vulnerability({
                        cveId,
                        title: notice.title || notice.id,
                        description: notice.summary || notice.description || 'No description available.',
                        publishedDate: notice.published ?? null,
                        type: 'Unknown',
                        // USN states affected releases, never a severity or score.
                        severity: 'Unknown',
                        source: 'ubuntu',
                        link: `https://ubuntu.com/security/notices/${notice.id}`,
                        exploited: false,
                        affectedTechnologies: packages,
                    })
                );
            }
        }

        logger.info({ count: vulns.length, notices: notices.length }, 'Successfully parsed Ubuntu notices');
        return vulns;
    });
}
