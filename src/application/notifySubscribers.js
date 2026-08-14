import logger from '../infrastructure/logger.js';
import { generateWeeklyReport } from './generateWeeklyReport.js';
import {
    listOwners,
    getAssignmentsByOwner,
    vulnerabilityRepositoryLinks,
    dependenciesWithLatest,
} from '../infrastructure/cache/repositoryStore.js';
import { sendWeeklyEmail, sendRepositoryAlert } from '../infrastructure/notifiers/emailNotifier.js';

/**
 * Subscribing to a repository.
 *
 * There is no subscriptions table: an owner assigned to a repository *is* the
 * subscription. `system_owners` already carries the name, the email and the
 * Slack id, `owner_assignments` already accepts target_type='repository', and
 * Slack already direct-messages the owners a vulnerability correlates to. A
 * second concept of "who cares about this repository" would only give the two a
 * chance to disagree.
 *
 * Two moments, deliberately different:
 *
 *   a vulnerability that reaches their repository  — now, one email
 *   a dependency that fell behind                  — the weekly digest
 *
 * A freshness check can mark dozens of packages at once and none of them is an
 * incident; a critical CVE in something you ship is not a Monday problem.
 */

/** Owners with at least one repository assignment, and which ones. */
export async function subscriptionsByRepositoryUrl() {
    const owners = await listOwners();
    const byUrl = new Map();

    for (const owner of owners) {
        const assignments = await getAssignmentsByOwner(owner.id);

        for (const assignment of assignments) {
            if (assignment.target_type !== 'repository') continue;

            const url = assignment.target_value;
            if (!byUrl.has(url)) byUrl.set(url, []);
            byUrl.get(url).push(owner);
        }
    }

    return byUrl;
}

/**
 * Tell the people who asked about these repositories that a CVE reached them.
 *
 * Called from the monitoring cycle with what the correlation already worked out,
 * so it costs one read of the assignments rather than a second correlation.
 *
 * @param {object} vulnerability The entity, as the cycle has it
 * @param {object[]} repositories Rows from correlateVulnerability()
 * @returns {Promise<number>} How many people were told
 */
export async function notifyRepositorySubscribers(vulnerability, repositories = []) {
    if (repositories.length === 0) return 0;

    const subscriptions = await subscriptionsByRepositoryUrl();
    if (subscriptions.size === 0) return 0;

    // One email per person, however many of their repositories it reached: a
    // CVE in a package six of your repositories share is one problem, not six.
    const perOwner = new Map();

    for (const repository of repositories) {
        for (const owner of subscriptions.get(repository.url) ?? []) {
            if (!owner.email) continue;

            if (!perOwner.has(owner.id)) perOwner.set(owner.id, { owner, repositories: [] });
            perOwner.get(owner.id).repositories.push(repository);
        }
    }

    for (const { owner, repositories: theirs } of perOwner.values()) {
        try {
            await sendRepositoryAlert(vulnerability, theirs, owner);
            logger.info(
                { cveId: vulnerability.cveId, owner: owner.email, repositories: theirs.length },
                'Told a subscriber about a vulnerability in their repository'
            );
        } catch (err) {
            // One subscriber's mail failing must not stop the cycle, or the
            // others.
            logger.warn({ err, owner: owner.email }, 'Could not notify subscriber');
        }
    }

    return perOwner.size;
}

/**
 * The weekly digest, once per subscriber, scoped to their repositories.
 *
 * This is where a dependency that fell behind is reported.
 *
 * @param {object} cache The vulnerability store
 * @returns {Promise<number>} How many digests were sent
 */
export async function sendSubscriberDigests(cache) {
    const subscriptions = await subscriptionsByRepositoryUrl();
    if (subscriptions.size === 0) return 0;

    const [vulnerabilities, links, dependencies] = await Promise.all([
        cache.getAll(),
        vulnerabilityRepositoryLinks(),
        dependenciesWithLatest(),
    ]);

    // The assignments name repository URLs; the report works in ids.
    const idByUrl = new Map();
    for (const link of links) idByUrl.set(link.repository_url, link.repository_id);
    for (const row of dependencies) idByUrl.set(row.repository_url, row.repository_id);

    const byOwner = new Map();
    for (const [url, owners] of subscriptions) {
        const repositoryId = idByUrl.get(url);
        if (repositoryId === undefined) continue; // nothing known about it yet

        for (const owner of owners) {
            if (!owner.email) continue;
            if (!byOwner.has(owner.id)) byOwner.set(owner.id, { owner, repositoryIds: [] });
            byOwner.get(owner.id).repositoryIds.push(repositoryId);
        }
    }

    let sent = 0;

    for (const { owner, repositoryIds } of byOwner.values()) {
        const report = generateWeeklyReport(vulnerabilities, { links, dependencies, repositoryIds });

        // Quiet week, quiet inbox: generateWeeklyReport returns null when a
        // scoped digest has nothing in its own repositories.
        if (!report) continue;

        try {
            await sendWeeklyEmail(report, {
                to: owner.email,
                subject: `Atalaia — your repositories, ${report.affecting.count} new`,
            });
            sent += 1;
        } catch (err) {
            logger.warn({ err, owner: owner.email }, 'Could not send subscriber digest');
        }
    }

    logger.info({ subscribers: byOwner.size, sent }, 'Subscriber digests done');
    return sent;
}
