import { Status } from '../domain/enums/Status.js';
import logger from '../infrastructure/logger.js';
import { acknowledgeVuln } from './acknowledgeVuln.js';
import { resolveVuln } from './resolveVuln.js';

/**
 * Acknowledge or resolve a selection of vulnerabilities.
 *
 * Partial success is the normal outcome, not an error: a selection made from a
 * table will contain rows that cannot make the transition — one already
 * resolved, one someone else acknowledged a second ago. Each is reported with
 * the reason rather than failing the whole call, because the alternative is an
 * operator ticking boxes one at a time to find out which one it was.
 *
 * No model runs here. See acknowledgeVuln's `mitigate` option for why.
 *
 * @param {string[]} cveIds
 * @param {'ACKNOWLEDGED'|'RESOLVED'} status
 * @param {string} changedBy
 * @param {{ get: Function, update: Function }} cache
 * @returns {Promise<{ requested: number, changed: number, skipped: number, changedIds: string[], results: object[] }>}
 */
export async function batchVulnStatus(cveIds, status, changedBy, cache) {
    const results = [];
    const changedIds = [];

    for (const cveId of cveIds) {
        try {
            if (status === Status.ACKNOWLEDGED) {
                await acknowledgeVuln(cveId, changedBy, cache, { mitigate: false });
            } else {
                await resolveVuln(cveId, changedBy, cache);
            }

            changedIds.push(cveId);
            results.push({ cveId, ok: true, status });
        } catch (error) {
            results.push({ cveId, ok: false, error: error.message });
        }
    }

    logger.info(
        { status, changedBy, requested: cveIds.length, changed: changedIds.length },
        'Batch status change'
    );

    return {
        requested: cveIds.length,
        changed: changedIds.length,
        skipped: cveIds.length - changedIds.length,
        changedIds,
        results,
    };
}
