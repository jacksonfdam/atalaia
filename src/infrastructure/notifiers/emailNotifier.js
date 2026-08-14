import nodemailer from 'nodemailer';
import logger from '../logger.js';
import { formatReportHtmlProfessional, formatReportHtmlMinimal } from './emailTemplates.js';
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
 */
export async function sendWeeklyEmail(report) {
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
    const to = config.recipients.join(',');
    const stats = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN']
        .map(severity => `${severity}:${(report.vulnerabilities[severity] || []).length}`)
        .join(', ');

    try {
        const transporter = nodemailer.createTransport(buildTransportOptions(config));

        await transporter.sendMail({
            from: config.from,
            to,
            subject: `Atalaia Weekly Report — ${report.totalCount} new in ${report.windowDays ?? 7} days [${stats}]`,
            html,
        });
        logger.info(
            { count: report.totalCount, template: config.template, provider: config.provider, to },
            'Weekly email sent'
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
 * Format a vulnerability report as HTML email content.
 * @param {object} report - Report object from generateWeeklyReport()
 * @returns {string} HTML content for email body
 */
export function formatReportHtml(report) {
    let html = `
<h2>Weekly Vulnerability Report</h2>
<p>Generated: ${report.generatedAt}</p>
<p>Total open/acknowledged vulnerabilities: <strong>${report.totalCount}</strong></p>
<hr/>`;

    for (const [severity, vulns] of Object.entries(report.vulnerabilities)) {
        if (vulns.length === 0) continue;

        html += `<h3>${severity} (${vulns.length})</h3><table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;">`;
        html += '<tr><th>CVE ID</th><th>Status</th><th>Source</th><th>Technologies</th></tr>';

        for (const v of vulns) {
            const techs = Array.isArray(v.affectedTechnologies)
                ? v.affectedTechnologies.join(', ')
                : v.affected_technologies || 'N/A';
            html += `<tr>
                <td>${v.cve_id || v.cveId || 'N/A'}</td>
                <td>${v.status || 'OPEN'}</td>
                <td>${v.source || 'N/A'}</td>
                <td>${techs}</td>
            </tr>`;
        }

        html += '</table>';
    }

    return html;
}
