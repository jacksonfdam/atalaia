import { query, queryAll, queryOne, withTransaction } from '../db/pool.js';
import logger from '../logger.js';

/**
 * The affected version ranges advisories publish, per package.
 *
 * Kept apart from the vulnerability row on purpose: a CVE is stored once, by
 * whichever feed delivered it first, and later feeds never rewrite it. Ranges
 * arrive from other sources and later, so they are keyed by source and replaced
 * wholesale per (CVE, source) rather than merged.
 */

/**
 * @typedef {object} AdvisoryPackage
 * @property {string} ecosystem        Atalaia's ecosystem (NPM, PIP, …), not the source's name for it
 * @property {string} name
 * @property {string} vulnerableRange  As the source wrote it
 * @property {string|null} [firstPatched]
 */

/**
 * Replace what one source says about one CVE.
 *
 * Does nothing for a CVE that is not stored: ranges are only ever of use for a
 * CVE that can match a repository, and an unstored one never will.
 *
 * @param {string} cveId
 * @param {string} source
 * @param {AdvisoryPackage[]} packages
 * @returns {Promise<number>} rows written
 */
export async function replaceAdvisoryPackages(cveId, source, packages) {
    const vulnerability = await queryOne('SELECT id FROM vulnerabilities WHERE cve_id = @cveId', { cveId });
    if (!vulnerability) return 0;

    await withTransaction(async client => {
        await query(
            'DELETE FROM advisory_packages WHERE vulnerability_id = @id AND source = @source',
            { id: vulnerability.id, source },
            client
        );

        for (const pkg of packages) {
            await query(
                `INSERT INTO advisory_packages
                     (vulnerability_id, source, ecosystem, package_name, vulnerable_range, first_patched)
                 VALUES (@id, @source, @ecosystem, @name, @range, @firstPatched)
                 ON CONFLICT DO NOTHING`,
                {
                    id: vulnerability.id,
                    source,
                    ecosystem: pkg.ecosystem,
                    name: pkg.name.toLowerCase(),
                    range: pkg.vulnerableRange,
                    firstPatched: pkg.firstPatched ?? null,
                },
                client
            );
        }

        await query(
            'UPDATE vulnerabilities SET ranges_checked_at = now() WHERE id = @id',
            { id: vulnerability.id },
            client
        );
    });

    logger.debug({ cveId, source, count: packages.length }, 'Advisory packages stored');
    return packages.length;
}

/**
 * Stored CVEs that name something the fleet ships and whose ranges have not been
 * asked for lately — the ones worth a lookup.
 *
 * @param {{ olderThanDays?: number, limit?: number }} [options]
 * @returns {Promise<string[]>} CVE ids, newest first
 */
export async function cvesNeedingRanges({ olderThanDays = 7, limit = 200 } = {}) {
    const rows = await queryAll(
        `SELECT v.cve_id
         FROM vulnerabilities v
         WHERE v.status <> 'RESOLVED'
           AND (v.ranges_checked_at IS NULL OR v.ranges_checked_at < now() - make_interval(days => @days))
           AND EXISTS (
               SELECT 1
               FROM jsonb_array_elements_text(v.affected_technologies) AS tech
               JOIN repository_dependencies d ON lower(d.name) = lower(tech) AND d.deleted_at IS NULL
           )
         ORDER BY v.first_seen_at DESC
         LIMIT @limit`,
        { days: olderThanDays, limit }
    );

    return rows.map(row => row.cve_id);
}
