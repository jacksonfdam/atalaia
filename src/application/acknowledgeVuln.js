import { Status, isValidTransition } from '../domain/enums/Status.js';
import logger from '../infrastructure/logger.js';
import { createLLMAdapter, renderPrompt } from '../infrastructure/llm/llmAdapter.js';
import { correlateVulnerability } from './correlateVulnerability.js';
import Vulnerability from '../domain/entities/Vulnerability.js';


/**
 * Acknowledge a vulnerability, transitioning its status from OPEN to ACKNOWLEDGED.
 * Generates an AI mitigation guide and correlates with affected repos/owners.
 *
 * @param {string} cveId
 * @param {string} changedBy - e.g. 'api:admin', 'slack:U12345'
 * @param {{ get: Function, update: Function }} cache
 * @returns {Promise<{ vuln: object, mitigation: string|null, affectedRepositories: object[], owners: object[] }>}
 */
export async function acknowledgeVuln(cveId, changedBy, cache) {
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

    // Correlate with repos and owners
    let correlation = { affectedRepositories: [], owners: [] };
    try {
        const vulnEntity = new Vulnerability({
            cveId: vuln.cve_id,
            title: vuln.title,
            description: vuln.description,
            severity: vuln.severity,
            cvssScore: vuln.cvss_score,
            exploited: vuln.exploited,
            affectedTechnologies: vuln.affectedTechnologies || [],
        });
        correlation = await correlateVulnerability(vulnEntity);
    } catch (err) {
        logger.warn({ cveId, err }, 'Correlation failed during acknowledge');
    }

    // Generate AI mitigation guide
    let mitigation = null;
    try {
        const repoNames = correlation.affectedRepositories.map(r => `- ${r.name} (${r.url})`).join('\n') || 'No affected repositories identified';
        const ownerNames = correlation.owners.map(o => `- ${o.name} (${o.email})`).join('\n') || 'No system owners assigned';

        const prompt = renderPrompt('mitigateCve.txt', {
            cveId: vuln.cve_id,
            title: vuln.title,
            description: vuln.description || 'No description available',
            severity: vuln.severity,
            cvssScore: vuln.cvss_score || 'N/A',
            exploited: vuln.exploited ? 'Yes — actively exploited' : 'No',
            technologies: (vuln.affectedTechnologies || []).join(', ') || 'Unknown',
            affectedRepos: repoNames,
            owners: ownerNames,
        });

        const llm = await createLLMAdapter();
        mitigation = await llm.complete(prompt);
        if (mitigation) {
            await cache.update(cveId, { clientExplanation: mitigation });
            logger.info({ cveId }, 'Mitigation guide generated');
        }
    } catch (err) {
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
