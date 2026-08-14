import { Status, isValidTransition } from '../domain/enums/Status.js';
import logger from '../infrastructure/logger.js';

/**
 * Resolve a vulnerability, transitioning its status to RESOLVED.
 * @param {string} cveId
 * @param {string} changedBy - e.g. 'api:admin', 'slack:U12345'
 * @param {{ get: Function, update: Function }} cache
 * @returns {object} Updated vulnerability row
 */
export async function resolveVuln(cveId, changedBy, cache) {
    const vuln = await cache.get(cveId);
    if (!vuln) throw new Error(`CVE ${cveId} not found`);

    const currentStatus = vuln.status || Status.OPEN;
    if (!isValidTransition(currentStatus, Status.RESOLVED)) {
        throw new Error(`Invalid transition: ${currentStatus} → ${Status.RESOLVED}`);
    }

    const now = new Date().toISOString();
    await cache.update(cveId, {
        status: Status.RESOLVED,
        statusChangedBy: changedBy,
        statusChangedAt: now,
        resolvedAt: now,
    });

    logger.info({ cveId, changedBy, from: currentStatus, to: Status.RESOLVED }, 'Vulnerability resolved');
    return await cache.get(cveId);
}
