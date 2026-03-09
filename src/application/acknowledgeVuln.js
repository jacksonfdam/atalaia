import { Status, isValidTransition } from '../domain/enums/Status.js';
import logger from '../infrastructure/logger.js';

/**
 * Acknowledge a vulnerability, transitioning its status from OPEN to ACKNOWLEDGED.
 * @param {string} cveId
 * @param {string} changedBy - e.g. 'api:admin', 'slack:U12345'
 * @param {{ get: Function, update: Function }} cache
 * @returns {object} Updated vulnerability row
 */
export async function acknowledgeVuln(cveId, changedBy, cache) {
    const vuln = cache.get(cveId);
    if (!vuln) throw new Error(`CVE ${cveId} not found`);

    const currentStatus = vuln.status || Status.OPEN;
    if (!isValidTransition(currentStatus, Status.ACKNOWLEDGED)) {
        throw new Error(`Invalid transition: ${currentStatus} → ${Status.ACKNOWLEDGED}`);
    }

    const now = new Date().toISOString();
    cache.update(cveId, {
        status: Status.ACKNOWLEDGED,
        statusChangedBy: changedBy,
        statusChangedAt: now,
    });

    logger.info({ cveId, changedBy, from: currentStatus, to: Status.ACKNOWLEDGED }, 'Vulnerability acknowledged');
    return cache.get(cveId);
}
