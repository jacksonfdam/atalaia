import logger from '../infrastructure/logger.js';
import { explainVulnerability } from './explainVulnerability.js';
import { mitigateVulnerability } from './mitigateVulnerability.js';

/**
 * Write the model's text for a selection of vulnerabilities.
 *
 * One model call per CVE, which is why this is a job and not a request: fifty
 * of them outlives any HTTP timeout worth having.
 *
 * Two kinds, because two prompts write the same column. `explanation` is what
 * this means, in plain words; `mitigation` is what to do about it, given the
 * repositories it reaches. Acknowledging one CVE writes the second, so a batch
 * acknowledgement enqueues the second and ends up where the single one does.
 */

/**
 * Errors kept in the progress row. Enough to see the pattern, not enough to
 * turn a bad model configuration into a megabyte of jsonb — `errorsTruncated`
 * says when there were more, so nothing is quietly lost.
 */
const MAX_ERRORS = 20;

/**
 * @param {object} params
 * @param {string[]} params.cveIds
 * @param {'explanation'|'mitigation'} [params.kind]
 * @param {boolean} [params.force] Rewrite text that is already there
 * @param {{ get: Function, update: Function }} params.cache
 * @param {(progress: object) => Promise<void>} [params.onProgress]
 * @returns {Promise<object>} The final progress snapshot
 */
export async function generateExplanations({
    cveIds,
    kind = 'explanation',
    force = false,
    cache,
    onProgress,
}) {
    const progress = {
        kind,
        total: cveIds.length,
        done: 0,
        written: 0,
        skipped: 0,
        failed: 0,
        current: null,
        errors: [],
        errorsTruncated: false,
    };

    for (const cveId of cveIds) {
        progress.current = cveId;
        await onProgress?.(progress);

        try {
            const row = await cache.get(cveId);
            if (!row) throw new Error(`CVE ${cveId} not found`);

            if (!force && row.client_explanation) {
                // The usual reason for running this is to fill in what was
                // collected before a model was configured. Rewriting text that
                // is already there costs money and changes nothing.
                progress.skipped += 1;
            } else if (kind === 'mitigation') {
                await mitigateVulnerability(cveId, cache);
                progress.written += 1;
            } else {
                await explainVulnerability(cveId, cache);
                progress.written += 1;
            }
        } catch (error) {
            progress.failed += 1;
            if (progress.errors.length < MAX_ERRORS) {
                progress.errors.push({ cveId, error: error.message });
            } else {
                progress.errorsTruncated = true;
            }
        }

        progress.done += 1;
        await onProgress?.(progress);
    }

    progress.current = null;
    await onProgress?.(progress);

    logger.info(
        { kind, total: progress.total, written: progress.written, skipped: progress.skipped, failed: progress.failed },
        'Batch text generation finished'
    );

    return progress;
}
