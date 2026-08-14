import { generateWeeklyReport } from './generateWeeklyReport.js';
import {
    vulnerabilityRepositoryLinks,
    dependenciesWithLatest,
} from '../infrastructure/cache/repositoryStore.js';

/**
 * The digest, assembled.
 *
 * generateWeeklyReport() is pure — it takes rows and returns a shape, which is
 * what makes it testable without a database. This is the part that fetches
 * those rows, and it exists so the route, the weekly job and the email test do
 * not each assemble the report slightly differently and then disagree.
 *
 * @param {object} cache The vulnerability store
 * @param {{ repositoryIds?: number[], windowDays?: number, now?: Date|string }} [options]
 * @returns {Promise<object|null>}
 */
export async function buildReport(cache, options = {}) {
    const [vulnerabilities, links, dependencies] = await Promise.all([
        cache.getAll(),
        vulnerabilityRepositoryLinks(),
        dependenciesWithLatest(),
    ]);

    return generateWeeklyReport(vulnerabilities, { ...options, links, dependencies });
}

export default buildReport;
