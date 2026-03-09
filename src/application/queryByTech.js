import { Status } from '../domain/enums/Status.js';

/**
 * Query vulnerabilities matching specific technologies.
 * Only returns OPEN and ACKNOWLEDGED vulns with case-insensitive matching.
 * @param {string[]} technologies - Technologies to match (OR logic)
 * @param {{ getAll: Function }} cache
 * @returns {Array} Matching vulnerabilities
 */
export function queryByTech(technologies, cache) {
    const techLower = technologies.map(t => t.toLowerCase());
    const allVulns = cache.getAll();

    return allVulns.filter(vuln => {
        if (![Status.OPEN, Status.ACKNOWLEDGED].includes(vuln.status)) {
            return false;
        }

        const vulnTechs = vuln.affectedTechnologies || [];
        return vulnTechs.some(vtech =>
            techLower.includes(vtech.toLowerCase())
        );
    });
}
