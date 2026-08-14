import nodemailer from 'nodemailer';
import logger from '../logger.js';
import {
    formatReportHtmlProfessional,
    formatReportHtmlMinimal,
    formatRepositoryAlertHtml,
} from './emailTemplates.js';
import { resolveEmailConfig } from './emailConfig.js';
import { buildTransportOptions } from './emailProviders.js';

function renderReport(report, template) {
    return template === 'minimal'
        ? formatReportHtmlMinimal(report)
        : formatReportHtmlProfessional(report);
}

/**
 * Send the weekly vulnerability report.
 *
 * Credentials come from resolveEmailConfig(), so the same code path serves an
 * env-pinned deployment and one configured from the console.
 *
 * @param {object|null} report Report from generateWeeklyReport()
 * @param {{ to?: string, subject?: string }} [override]
 *   Who to send it to instead of the configured recipients. The per-repository
 *   digests use this: same report machinery, one subscriber's address.
 */
export async function sendWeeklyEmail(report, override = {}) {
    if (!report) {
        logger.info('No vulnerabilities for weekly report, skipping email');
        return;
    }

    const config = await resolveEmailConfig();
    if (!config.ready) {
        logger.warn({ reason: config.reason, source: config.source }, 'Email not configured, skipping weekly report');
        return;
    }

    const html = renderReport(report, config.template);
    const to = override.to ?? config.recipients.join(',');

    if (!to) {
        logger.warn('No recipient for the report, skipping');
        return;
    }

    const subject =
        override.subject ??
        `Atalaia Weekly Report — ${report.affecting.count} affecting, ${report.totalCount} new in ${report.windowDays ?? 7} days`;

    try {
        const transporter = nodemailer.createTransport(buildTransportOptions(config));

        await transporter.sendMail({
            from: config.from,
            to,
            subject,
            html,
        });
        logger.info(
            { count: report.totalCount, affecting: report.affecting.count, provider: config.provider, to },
            'Report email sent'
        );
    } catch (err) {
        // A scheduled send must not reject: this runs inside a cron callback,
        // where a rejection would surface as an unhandled promise rejection.
        // The console's test button uses sendTestEmail(), which does report back.
        logger.error({ err, provider: config.provider }, 'Failed to send weekly email');
    }
}

/**
 * Open a connection and authenticate, without sending anything.
 *
 * @returns {Promise<{ ok: boolean, provider: string, host?: string, port?: number, error?: string }>}
 */
export async function verifyEmailTransport() {
    const config = await resolveEmailConfig();

    // A verify only needs a reachable server and valid credentials; missing
    // recipients would fail the readiness check but not the connection.
    if (config.source === 'none') {
        return { ok: false, provider: config.provider, error: 'No email provider configured' };
    }

    const options = buildTransportOptions(config);

    try {
        await nodemailer.createTransport(options).verify();
        return { ok: true, provider: config.provider, host: options.host, port: options.port };
    } catch (err) {
        logger.warn({ err, provider: config.provider }, 'Email transport verification failed');
        return { ok: false, provider: config.provider, host: options.host, port: options.port, error: err.message };
    }
}

/**
 * Send a real message so the operator can see the template land in an inbox.
 *
 * @param {object|null} report Optional real report; a sample is used without one
 * @returns {Promise<{ ok: boolean, to?: string[], messageId?: string, error?: string }>}
 */
export async function sendTestEmail(report = null) {
    const config = await resolveEmailConfig();
    if (!config.ready) {
        return { ok: false, error: config.reason ?? 'Email is not configured' };
    }

    const payload = report ?? {
        generatedAt: new Date().toISOString(),
        windowDays: 7,
        since: new Date(Date.now() - 7 * 86_400_000).toISOString(),
        totalCount: 0,
        vulnerabilities: { CRITICAL: [], HIGH: [], MEDIUM: [], LOW: [], UNKNOWN: [] },
        openTotal: 0,
        openBySeverity: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, UNKNOWN: 0 },
    };

    try {
        const transporter = nodemailer.createTransport(buildTransportOptions(config));
        const info = await transporter.sendMail({
            from: config.from,
            to: config.recipients.join(','),
            subject: '[TEST] Atalaia weekly report',
            html: renderReport(payload, config.template),
        });

        logger.info({ provider: config.provider, to: config.recipients }, 'Test email sent');
        return { ok: true, to: config.recipients, messageId: info.messageId };
    } catch (err) {
        logger.error({ err, provider: config.provider }, 'Test email failed');
        return { ok: false, error: err.message };
    }
}

/**
 * Tell one subscriber that one CVE reached their repository.
 *
 * Not a digest: a digest is what Monday is for. This is the thing that happened
 * in the repository they asked about, with the manifest file that carries it,
 * because that is the file they have to open.
 *
 * @param {object} vulnerability
 * @param {object[]} repositories The ones of theirs it reaches
 * @param {{ email: string, name?: string }} owner
 */
export async function sendRepositoryAlert(vulnerability, repositories, owner) {
    const config = await resolveEmailConfig();
    if (!config.ready) {
        logger.debug({ reason: config.reason }, 'Email not configured, skipping subscriber alert');
        return { ok: false, error: config.reason };
    }

    const severity = (vulnerability.severity || 'UNKNOWN').toUpperCase();
    const names = repositories.map(repo => repo.name).join(', ');

    const html = formatRepositoryAlertHtml(vulnerability, repositories, owner);

    try {
        const transporter = nodemailer.createTransport(buildTransportOptions(config));

        await transporter.sendMail({
            from: config.from,
            to: owner.email,
            subject: `[${severity}] ${vulnerability.cveId} in ${names}`,
            html,
        });

        return { ok: true };
    } catch (err) {
        logger.error({ err, owner: owner.email }, 'Failed to send subscriber alert');
        return { ok: false, error: err.message };
    }
}
