import { Status, isValidTransition } from '../domain/enums/Status.js';
import logger from '../infrastructure/logger.js';
import { mitigateVulnerability, correlateForRow } from './mitigateVulnerability.js';

/**
 * Acknowledge a vulnerability, transitioning its status from OPEN to ACKNOWLEDGED.
 * Generates an AI mitigation guide and correlates with affected repos/owners.
 *
 * @param {string} cveId
 * @param {string} changedBy - e.g. 'api:admin', 'slack:U12345'
 * @param {{ get: Function, update: Function }} cache
 * @param {{ mitigate?: boolean }} [options] `mitigate: false` performs the
 *   transition alone — no correlation, no model. That is what a batch does: a
 *   hundred acknowledgements is a hundred model calls, which does not belong
 *   inside a request. The batch enqueues the guides instead, so the end state
 *   is the same one this function reaches on its own.
 * @returns {Promise<{ vuln: object, mitigation: string|null, affectedRepositories: object[], owners: object[] }>}
 */
export async function acknowledgeVuln(cveId, changedBy, cache, { mitigate = true } = {}) {
    const vuln = await cache.get(cveId);
    if (!vuln) throw new Error(`CVE ${cveId} not found`);

    const currentStatus = vuln.status || Status.OPEN;
    if (!isValidTransition(currentStatus, Status.ACKNOWLEDGED)) {
        throw new Error(`Invalid transition: ${currentStatus} → ${Status.ACKNOWLEDGED}`);
    }

    const now = new Date().toISOString();
    await cache.update(cveId, {
        status: Status.ACKNOWLEDGED,
        statusChangedBy: changedBy,
        statusChangedAt: now,
    });

    logger.info({ cveId, changedBy, from: currentStatus, to: Status.ACKNOWLEDGED }, 'Vulnerability acknowledged');

    if (!mitigate) {
        return {
            vuln: await cache.get(cveId),
            mitigation: null,
            affectedRepositories: [],
            owners: [],
        };
    }

    // Correlated here rather than inside the guide, so that a model which is
    // down or unconfigured still leaves the caller with the repositories and
    // owners this reaches — the half of the answer that needs no model.
    const correlation = await correlateForRow(vuln);

    let mitigation = null;
    try {
        ({ mitigation } = await mitigateVulnerability(cveId, cache, correlation));
    } catch (err) {
        // Best-effort: the status change is the point, the guide is the bonus.
        logger.warn({ cveId, err }, 'Mitigation guide generation failed');
    }

    const updated = await cache.get(cveId);
    return {
        vuln: updated,
        mitigation,
        affectedRepositories: correlation.affectedRepositories,
        owners: correlation.owners,
    };
}
