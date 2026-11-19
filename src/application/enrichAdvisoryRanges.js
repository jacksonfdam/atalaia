import logger from '../infrastructure/logger.js';
import { replaceAdvisoryPackages, cvesNeedingRanges } from '../infrastructure/cache/advisoryStore.js';
import { fetchPackagesForCve } from '../infrastructure/feeds/ghsaFeed.js';

/**
 * Fill in the version ranges of CVEs that were stored before anyone had them.
 *
 * A CVE is stored once, by whichever feed delivered it first, and the feeds that
 * carry ranges rarely arrive first — so a CVE that names a dependency of yours
 * can sit with no range at all, and read as "could not verify" forever. This asks
 * GitHub for exactly those, a bounded number per run.
 *
 * Read-only outward: one GET per CVE. A CVE GitHub does not know is recorded as
 * checked, with no ranges, so it is not asked again until the retry window.
 *
 * @param {object} [options]
 * @param {number} [options.limit]   CVEs per run; unauthenticated callers get 60 requests an hour
 * @param {(cveId: string) => Promise<object[]>} [options.lookup]
 * @returns {Promise<{ checked: number, withRanges: number, failed: number, stoppedEarly: boolean }>}
 */
export async function enrichAdvisoryRanges({ limit = 100, lookup = fetchPackagesForCve } = {}) {
    const cveIds = await cvesNeedingRanges({ limit });
    const result = { checked: 0, withRanges: 0, failed: 0, stoppedEarly: false };

    for (const cveId of cveIds) {
        try {
            const packages = await lookup(cveId);
            await replaceAdvisoryPackages(cveId, 'ghsa', packages);

            result.checked += 1;
            if (packages.length > 0) result.withRanges += 1;
        } catch (err) {
            result.failed += 1;

            // Out of requests: every remaining CVE would fail the same way, and
            // not recording them as checked means the next run asks again.
            const status = err.response?.status;
            if (status === 403 || status === 429) {
                logger.warn({ status, remaining: cveIds.length - result.checked }, 'GitHub rate limit reached; stopping the range lookup');
                result.stoppedEarly = true;
                break;
            }

            logger.warn({ cveId, err: err.message }, 'Could not look up advisory ranges');
        }
    }

    logger.info(result, 'Advisory ranges enriched');
    return result;
}
