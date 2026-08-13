import nodemailer from 'nodemailer';
import logger from '../logger.js';
import { formatReportHtmlProfessional, formatReportHtmlMinimal } from './emailTemplates.js';

/**
 * Send the weekly vulnerability report via email.
 * @param {object|null} report - Report from generateWeeklyReport()
 */
export async function sendWeeklyEmail(report) {
    if (!report) {
        logger.info('No vulnerabilities for weekly report, skipping email');
        return;
    }

    const host = process.env.SMTP_HOST;
    const port = parseInt(process.env.SMTP_PORT || '587', 10);
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    const from = process.env.EMAIL_FROM || 'atalaia@localhost';
    const recipients = process.env.EMAIL_RECIPIENTS;

    if (!host || !recipients) {
        logger.warn('SMTP_HOST or EMAIL_RECIPIENTS not configured, skipping weekly email');
        return;
    }

    // Select template based on environment variable (default: professional)
    const templateType = (process.env.EMAIL_TEMPLATE || 'professional').toLowerCase();
    const html = templateType === 'minimal'
        ? formatReportHtmlMinimal(report)
        : formatReportHtmlProfessional(report);

    const to = recipients.split(',').map(e => e.trim()).join(',');
    const stats = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN']
        .map(severity => `${severity}:${(report.vulnerabilities[severity] || []).length}`)
        .join(', ');

    try {
        const transporter = nodemailer.createTransport({
            host,
            port,
            secure: port === 465,
            ...(user && pass ? { auth: { user, pass } } : {}),
        });

        await transporter.sendMail({
            from,
            to,
            subject: `Atalaia Weekly Report — ${report.totalCount} new in ${report.windowDays ?? 7} days [${stats}]`,
            html,
        });
        logger.info({ count: report.totalCount, template: templateType, to }, 'Weekly email sent');
    } catch (err) {
        logger.error({ err }, 'Failed to send weekly email');
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
