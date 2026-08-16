import logger from '../logger.js';
import { resolveTelegramConfig } from './telegramConfig.js';
import { deliver, escapeHtml } from './notifyTelegram.js';

/**
 * The weekly digest, in a chat.
 *
 * The email version is a full HTML report; this one is a message somebody reads
 * on a phone, so it says the numbers and names what is worst. The point of
 * carrying it here at all is the dependency section: a package that fell behind
 * is not an incident, which is exactly why it waits for the digest instead of
 * interrupting anyone at the moment a freshness check notices.
 *
 * Telegram allows 4096 characters. Rather than truncate mid-list, each section
 * is capped and states its own total, so what is cut off is still counted.
 */

const REPOSITORIES_LISTED = 5;
const DEPENDENCIES_PER_REPOSITORY = 5;
const MESSAGE_LIMIT = 4096;

function pluralize(count, singular, plural = `${singular}s`) {
    return `${count} ${count === 1 ? singular : plural}`;
}

/**
 * @param {object} report Output of generateWeeklyReport / buildReport
 * @param {{ scopeLabel?: string }} [options]
 * @returns {{ text: string }|null} null when there is nothing to say
 */
export function buildDigestMessage(report, options = {}) {
    if (!report) return null;

    const lines = [];
    const heading = options.scopeLabel
        ? `📋 <b>Weekly digest — ${escapeHtml(options.scopeLabel)}</b>`
        : '📋 <b>Weekly digest</b>';

    lines.push(heading);
    lines.push(
        `<i>${report.windowDays} days · ${pluralize(report.totalCount, 'new finding')} · ` +
            `${report.openTotal} still open</i>`
    );

    const affecting = report.affecting ?? { count: 0, openCount: 0, repositories: [] };

    lines.push('', `🎯 <b>Reaching our code:</b> ${affecting.count} new, ${affecting.openCount ?? 0} open`);

    for (const repository of (affecting.repositories ?? []).slice(0, REPOSITORIES_LISTED)) {
        const name = repository.url
            ? `<a href="${escapeHtml(repository.url)}">${escapeHtml(repository.name)}</a>`
            : escapeHtml(repository.name);

        const worst = (repository.vulnerabilities ?? [])
            .slice(0, 3)
            .map(vuln => `${escapeHtml(vuln.cveId ?? vuln.cve_id)} (${escapeHtml(vuln.severity)})`)
            .join(', ');

        lines.push(`• ${name} — ${worst || pluralize(repository.vulnerabilities?.length ?? 0, 'finding')}`);
    }

    const moreRepositories = (affecting.repositories?.length ?? 0) - REPOSITORIES_LISTED;
    if (moreRepositories > 0) lines.push(`<i>…and ${moreRepositories} more repositories</i>`);

    if (report.infrastructure?.count) {
        lines.push('', `🏗 <b>Infrastructure:</b> ${report.infrastructure.count} new`);
    }

    // The reason this digest exists: what fell behind, grouped the way somebody
    // would actually go and fix it — one repository at a time.
    const dependencies = report.dependencies ?? { count: 0, repositories: [] };

    if (dependencies.count > 0) {
        lines.push('', `📦 <b>Dependencies behind:</b> ${dependencies.count}`);

        for (const repository of dependencies.repositories.slice(0, REPOSITORIES_LISTED)) {
            lines.push(`<b>${escapeHtml(repository.name)}</b>`);

            for (const dependency of repository.dependencies.slice(0, DEPENDENCIES_PER_REPOSITORY)) {
                lines.push(
                    `  • ${escapeHtml(dependency.name)} ` +
                        `${escapeHtml(dependency.declared)} → ${escapeHtml(dependency.latest)}` +
                        (dependency.gap ? ` <i>(${escapeHtml(dependency.gap)})</i>` : '')
                );
            }

            const rest = repository.dependencies.length - DEPENDENCIES_PER_REPOSITORY;
            if (rest > 0) lines.push(`  <i>…and ${rest} more</i>`);
        }

        const moreBehind = dependencies.repositories.length - REPOSITORIES_LISTED;
        if (moreBehind > 0) lines.push(`<i>…and ${moreBehind} more repositories</i>`);
    }

    if (report.totalCount === 0 && report.openTotal === 0 && dependencies.count === 0) {
        return null;
    }

    const text = lines.join('\n');
    return { text: text.length > MESSAGE_LIMIT ? `${text.slice(0, MESSAGE_LIMIT - 1)}…` : text };
}

/**
 * Send the digest to the configured chat.
 *
 * @param {object} report
 * @returns {Promise<{ sent: boolean, reason?: string }>}
 */
export async function sendTelegramDigest(report) {
    const config = await resolveTelegramConfig();
    if (!config.ready) return { sent: false, reason: config.reason ?? 'Telegram is not configured' };

    const message = buildDigestMessage(report);
    if (!message) return { sent: false, reason: 'Nothing to report this period' };

    try {
        await deliver(config, message);
        logger.info('Sent the weekly digest to Telegram');
        return { sent: true };
    } catch (err) {
        logger.error({ err }, 'Failed to send the weekly digest to Telegram');
        return { sent: false, reason: err.message };
    }
}

/**
 * Send one subscriber their own digest, scoped to their repositories.
 *
 * @param {object} report
 * @param {{ name?: string, email?: string, telegram_chat_id?: string }} owner
 * @returns {Promise<boolean>} whether anything was sent
 */
export async function sendTelegramDigestTo(report, owner) {
    if (!owner?.telegram_chat_id) return false;

    const config = await resolveTelegramConfig();
    if (!config.botToken) return false;

    const message = buildDigestMessage(report, { scopeLabel: 'your repositories' });
    if (!message) return false;

    try {
        await deliver(config, message, owner.telegram_chat_id);
        logger.info({ owner: owner.email }, 'Sent a subscriber digest on Telegram');
        return true;
    } catch (err) {
        logger.warn({ err, owner: owner.email }, 'Could not send the subscriber digest on Telegram');
        return false;
    }
}
