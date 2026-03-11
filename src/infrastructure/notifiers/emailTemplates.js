/**
 * Professional and minimal email templates for vulnerability reports.
 * Both templates use inline CSS for maximum email client compatibility.
 */

// Severity color scheme
const SEVERITY_COLORS = {
    CRITICAL: '#DC3545', // Red
    HIGH: '#FD7E14', // Orange
    MEDIUM: '#FFC107', // Yellow
    LOW: '#17A2B8', // Teal
    UNKNOWN: '#6C757D', // Gray
};

const UTILITY_COLORS = {
    background: '#F5F5F5',
    text: '#333333',
    textMuted: '#666666',
    border: '#DDDDDD',
    success: '#28A745',
    warning: '#FFB900',
};

/**
 * Professional & Colorful Email Template (Snyk-inspired)
 * Features: Logo/branding, color-coded severity, summary statistics, enhanced styling
 *
 * @param {object} report - Report from generateWeeklyReport()
 * @returns {string} HTML email body
 */
export function formatReportHtmlProfessional(report) {
    const stats = calculateStats(report);
    const generatedDate = new Date(report.generatedAt).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    });

    const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Weekly Vulnerability Report</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; margin: 0; padding: 0; background-color: ${UTILITY_COLORS.background};">
    <div style="max-width: 600px; margin: 0 auto; background-color: #FFFFFF; border-collapse: collapse;">
        <!-- Header with branding -->
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 30px; text-align: center; color: white;">
            <h1 style="margin: 0; font-size: 28px; font-weight: 700;">Atalaia</h1>
            <p style="margin: 8px 0 0 0; font-size: 14px; opacity: 0.9;">Weekly Vulnerability Report</p>
        </div>

        <!-- Date range -->
        <div style="padding: 20px 30px; background-color: #F9FAFB; border-bottom: 1px solid ${UTILITY_COLORS.border}; text-align: center;">
            <p style="margin: 0; font-size: 12px; color: ${UTILITY_COLORS.textMuted};">Report Generated: ${generatedDate}</p>
        </div>

        <!-- Summary Statistics -->
        <div style="padding: 30px; text-align: center;">
            <h2 style="margin: 0 0 30px 0; font-size: 24px; color: ${UTILITY_COLORS.text};">
                🔍 Summary
            </h2>

            <div style="display: block; margin-bottom: 20px;">
                <div style="font-size: 48px; font-weight: 700; color: #667eea; margin-bottom: 8px;">
                    ${report.totalCount}
                </div>
                <p style="margin: 0; font-size: 14px; color: ${UTILITY_COLORS.textMuted};">
                    Open/Acknowledged Vulnerabilities
                </p>
            </div>

            <!-- Severity breakdown boxes -->
            <div style="display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 10px; margin-top: 20px;">
                <div style="background-color: #FFEBEE; padding: 15px; border-radius: 8px; border-left: 4px solid ${SEVERITY_COLORS.CRITICAL};">
                    <div style="font-size: 24px; font-weight: 700; color: ${SEVERITY_COLORS.CRITICAL};">
                        ${stats.critical}
                    </div>
                    <div style="font-size: 12px; color: ${UTILITY_COLORS.textMuted}; margin-top: 4px;">CRITICAL</div>
                </div>
                <div style="background-color: #FFF3E0; padding: 15px; border-radius: 8px; border-left: 4px solid ${SEVERITY_COLORS.HIGH};">
                    <div style="font-size: 24px; font-weight: 700; color: ${SEVERITY_COLORS.HIGH};">
                        ${stats.high}
                    </div>
                    <div style="font-size: 12px; color: ${UTILITY_COLORS.textMuted}; margin-top: 4px;">HIGH</div>
                </div>
                <div style="background-color: #FFFDE7; padding: 15px; border-radius: 8px; border-left: 4px solid ${SEVERITY_COLORS.MEDIUM};">
                    <div style="font-size: 24px; font-weight: 700; color: ${SEVERITY_COLORS.MEDIUM};">
                        ${stats.medium}
                    </div>
                    <div style="font-size: 12px; color: ${UTILITY_COLORS.textMuted}; margin-top: 4px;">MEDIUM</div>
                </div>
                <div style="background-color: #E0F2F1; padding: 15px; border-radius: 8px; border-left: 4px solid ${SEVERITY_COLORS.LOW};">
                    <div style="font-size: 24px; font-weight: 700; color: ${SEVERITY_COLORS.LOW};">
                        ${stats.low}
                    </div>
                    <div style="font-size: 12px; color: ${UTILITY_COLORS.textMuted}; margin-top: 4px;">LOW</div>
                </div>
            </div>
        </div>

        <!-- Vulnerability Details Table -->
        <div style="padding: 30px; border-top: 2px solid ${UTILITY_COLORS.border};">
            <h2 style="margin: 0 0 20px 0; font-size: 18px; color: ${UTILITY_COLORS.text};">
                📋 Vulnerability Details
            </h2>

            ${renderVulnerabilityTable(report, 'professional')}
        </div>

        <!-- Footer -->
        <div style="background-color: #F9FAFB; padding: 30px; border-top: 1px solid ${UTILITY_COLORS.border}; text-align: center; font-size: 12px; color: ${UTILITY_COLORS.textMuted};">
            <p style="margin: 0 0 10px 0;">
                This is an automated security report from Atalaia.
            </p>
            <p style="margin: 0;">
                <a href="https://github.com/atalaia" style="color: #667eea; text-decoration: none;">View on GitHub</a> •
                <a href="https://atalaia.dev" style="color: #667eea; text-decoration: none;">Learn More</a>
            </p>
        </div>
    </div>
</body>
</html>
    `;

    return html;
}

/**
 * Minimalist & Clean Email Template
 * Features: Modern, minimal design with focus on readability
 *
 * @param {object} report - Report from generateWeeklyReport()
 * @returns {string} HTML email body
 */
export function formatReportHtmlMinimal(report) {
    const stats = calculateStats(report);
    const generatedDate = new Date(report.generatedAt).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    });

    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Weekly Vulnerability Report</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; margin: 0; padding: 0; background-color: #FFFFFF;">
    <div style="max-width: 600px; margin: 0 auto;">
        <!-- Simple Header -->
        <div style="padding: 40px 30px; border-bottom: 1px solid ${UTILITY_COLORS.border};">
            <h1 style="margin: 0; font-size: 24px; font-weight: 600; color: ${UTILITY_COLORS.text};">
                Weekly Vulnerability Report
            </h1>
            <p style="margin: 8px 0 0 0; font-size: 13px; color: ${UTILITY_COLORS.textMuted};">
                ${generatedDate}
            </p>
        </div>

        <!-- Summary -->
        <div style="padding: 30px;">
            <p style="margin: 0 0 20px 0; font-size: 15px; color: ${UTILITY_COLORS.text};">
                <strong>Total Vulnerabilities:</strong> ${report.totalCount} open/acknowledged
            </p>

            <!-- Severity breakdown as text -->
            <div style="background-color: ${UTILITY_COLORS.background}; padding: 15px; border-radius: 4px; border-left: 3px solid #667eea;">
                <p style="margin: 0; font-size: 13px;">
                    <span style="color: ${SEVERITY_COLORS.CRITICAL}; font-weight: 600;">● ${stats.critical} Critical</span> •
                    <span style="color: ${SEVERITY_COLORS.HIGH}; font-weight: 600;">● ${stats.high} High</span> •
                    <span style="color: ${SEVERITY_COLORS.MEDIUM}; font-weight: 600;">● ${stats.medium} Medium</span> •
                    <span style="color: ${SEVERITY_COLORS.LOW}; font-weight: 600;">● ${stats.low} Low</span>
                </p>
            </div>
        </div>

        <!-- Vulnerability Details -->
        <div style="padding: 0 30px 30px 30px; border-top: 1px solid ${UTILITY_COLORS.border};">
            ${renderVulnerabilityTable(report, 'minimal')}
        </div>

        <!-- Footer -->
        <div style="padding: 30px; border-top: 1px solid ${UTILITY_COLORS.border}; font-size: 12px; color: ${UTILITY_COLORS.textMuted};">
            <p style="margin: 0;">Atalaia • Automated Security Monitoring</p>
        </div>
    </div>
</body>
</html>
    `;
}

/**
 * Render vulnerability table with styling based on template type
 * @private
 */
function renderVulnerabilityTable(report, templateType) {
    let html = '<table style="width: 100%; border-collapse: collapse;">';
    html += `
        <tr style="border-bottom: 2px solid ${UTILITY_COLORS.border}; background-color: ${UTILITY_COLORS.background};">
            <th style="padding: 12px 8px; text-align: left; font-size: 12px; font-weight: 600; color: ${UTILITY_COLORS.text};">CVE ID</th>
            <th style="padding: 12px 8px; text-align: left; font-size: 12px; font-weight: 600; color: ${UTILITY_COLORS.text};">Severity</th>
            <th style="padding: 12px 8px; text-align: left; font-size: 12px; font-weight: 600; color: ${UTILITY_COLORS.text};">CVSS</th>
            <th style="padding: 12px 8px; text-align: left; font-size: 12px; font-weight: 600; color: ${UTILITY_COLORS.text};">Source</th>
            <th style="padding: 12px 8px; text-align: left; font-size: 12px; font-weight: 600; color: ${UTILITY_COLORS.text};">Status</th>
        </tr>
    `;

    // Iterate through severity levels
    const severities = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
    let rowCount = 0;

    for (const severity of severities) {
        const vulns = report.vulnerabilities[severity] || [];

        for (const vuln of vulns) {
            const bgColor = rowCount % 2 === 0 ? '#FFFFFF' : UTILITY_COLORS.background;
            const severityColor = SEVERITY_COLORS[severity] || SEVERITY_COLORS.UNKNOWN;
            const cvssDisplay = vuln.cvssScore ? `${vuln.cvssScore.toFixed(1)}` : 'N/A';

            html += `
        <tr style="border-bottom: 1px solid ${UTILITY_COLORS.border}; background-color: ${bgColor};">
            <td style="padding: 12px 8px; border-left: 3px solid ${severityColor}; font-size: 12px;">
                <strong>${vuln.cve_id || vuln.cveId}</strong>
            </td>
            <td style="padding: 12px 8px; font-size: 12px;">
                <span style="color: ${severityColor}; font-weight: 600;">●</span> ${severity}
            </td>
            <td style="padding: 12px 8px; font-size: 12px; text-align: center;">
                ${cvssDisplay}
            </td>
            <td style="padding: 12px 8px; font-size: 12px;">
                ${vuln.source || 'N/A'}
            </td>
            <td style="padding: 12px 8px; font-size: 12px;">
                <span style="background-color: ${getStatusColor(vuln.status)}; color: white; padding: 3px 8px; border-radius: 3px; font-size: 11px; font-weight: 500;">
                    ${vuln.status || 'OPEN'}
                </span>
            </td>
        </tr>
            `;

            rowCount++;
        }
    }

    html += '</table>';
    return html;
}

/**
 * Helper: Get status badge color
 * @private
 */
function getStatusColor(status) {
    switch (status?.toUpperCase()) {
        case 'OPEN':
            return SEVERITY_COLORS.CRITICAL;
        case 'ACKNOWLEDGED':
            return UTILITY_COLORS.warning;
        case 'RESOLVED':
            return UTILITY_COLORS.success;
        default:
            return UTILITY_COLORS.textMuted;
    }
}

/**
 * Helper: Calculate severity statistics
 * @private
 */
function calculateStats(report) {
    return {
        critical: (report.vulnerabilities.CRITICAL || []).length,
        high: (report.vulnerabilities.HIGH || []).length,
        medium: (report.vulnerabilities.MEDIUM || []).length,
        low: (report.vulnerabilities.LOW || []).length,
    };
}

/**
 * Helper: Get severity color
 * @public
 */
export function getSeverityColor(severity) {
    return SEVERITY_COLORS[severity?.toUpperCase()] || SEVERITY_COLORS.UNKNOWN;
}

/**
 * Helper: Format CVSS score
 * @public
 */
export function formatCVSSScore(score) {
    if (!score) return 'N/A';
    return `${score.toFixed(1)}/10`;
}

/**
 * Helper: Format technologies as tags
 * @public
 */
export function formatTechnologiesTags(techs) {
    if (!techs || techs.length === 0) return 'N/A';
    if (typeof techs === 'string') return techs;
    return techs.join(', ');
}

/**
 * Helper: Format status indicator
 * @public
 */
export function formatStatusIndicator(status) {
    const colors = {
        OPEN: '🔴',
        ACKNOWLEDGED: '🟡',
        RESOLVED: '🟢',
    };
    return `${colors[status] || '⚪'} ${status || 'UNKNOWN'}`;
}

/**
 * Helper: Get exploited warning
 * @public
 */
export function getExploitedWarning(exploited) {
    return exploited ? '⚠️ EXPLOITED' : '';
}
