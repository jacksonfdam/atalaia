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
                    New in the last ${report.windowDays ?? 7} days
                </p>
                <p style="margin: 6px 0 0 0; font-size: 13px; color: ${UTILITY_COLORS.textMuted};">
                    ${report.openTotal ?? report.totalCount} open or acknowledged in total
                </p>
            </div>

            <!-- Severity breakdown boxes -->
            <div style="display: grid; grid-template-columns: 1fr 1fr 1fr 1fr 1fr; gap: 10px; margin-top: 20px;">
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
                <div style="background-color: #F1F3F5; padding: 15px; border-radius: 8px; border-left: 4px solid ${SEVERITY_COLORS.UNKNOWN};">
                    <div style="font-size: 24px; font-weight: 700; color: ${SEVERITY_COLORS.UNKNOWN};">
                        ${stats.unknown}
                    </div>
                    <div style="font-size: 12px; color: ${UTILITY_COLORS.textMuted}; margin-top: 4px;">UNRATED</div>
                </div>
            </div>
        </div>

        <!-- Vulnerability Details Table -->
        <div style="padding: 30px; border-top: 2px solid ${UTILITY_COLORS.border};">
            <h2 style="margin: 0 0 20px 0; font-size: 18px; color: ${UTILITY_COLORS.text};">
                📋 Vulnerability Details
            </h2>

            ${renderBody(report)}
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
                <strong>New in the last ${report.windowDays ?? 7} days:</strong> ${report.totalCount}
                <span style="color: ${UTILITY_COLORS.textMuted};">
                    · ${report.openTotal ?? report.totalCount} open or acknowledged in total
                </span>
            </p>

            <!-- Severity breakdown as text -->
            <div style="background-color: ${UTILITY_COLORS.background}; padding: 15px; border-radius: 4px; border-left: 3px solid #667eea;">
                <p style="margin: 0; font-size: 13px;">
                    <span style="color: ${SEVERITY_COLORS.CRITICAL}; font-weight: 600;">● ${stats.critical} Critical</span> •
                    <span style="color: ${SEVERITY_COLORS.HIGH}; font-weight: 600;">● ${stats.high} High</span> •
                    <span style="color: ${SEVERITY_COLORS.MEDIUM}; font-weight: 600;">● ${stats.medium} Medium</span> •
                    <span style="color: ${SEVERITY_COLORS.LOW}; font-weight: 600;">● ${stats.low} Low</span> •
                    <span style="color: ${SEVERITY_COLORS.UNKNOWN}; font-weight: 600;">● ${stats.unknown} Unrated</span>
                </p>
            </div>
        </div>

        <!-- Vulnerability Details -->
        <div style="padding: 0 30px 30px 30px; border-top: 1px solid ${UTILITY_COLORS.border};">
            ${renderBody(report)}
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
/**
 * The body: what reaches your code, grouped by the repository it reaches.
 *
 * The digest used to be one table ordered by severity, listing every row ever
 * collected — thousands, while the console led with the twenty-seven that name
 * something the fleet ships. Same rule, same numbers, and grouped by the thing
 * somebody owns.
 */
function renderAffecting(report) {
    const { count, repositories } = report.affecting;

    if (count === 0) {
        return `<p style="margin: 0 0 24px 0; font-size: 14px; color: ${UTILITY_COLORS.textMuted};">
            Nothing new reached your repositories this period.
        </p>`;
    }

    let html = `<h3 style="margin: 0 0 4px 0; font-size: 18px; color: ${UTILITY_COLORS.text};">
        Affects your code — ${count} new
    </h3>
    <p style="margin: 0 0 20px 0; font-size: 12px; color: ${UTILITY_COLORS.textMuted};">
        A dependency of a tracked repository is named in these.
        ${report.affecting.openCount ? `${report.affecting.openCount} open in total; with containers and CI folded in, the console counts ${report.affecting.openCount + (report.infrastructure.openCount ?? 0)} as affecting this fleet.` : ''}
    </p>`;

    for (const repo of repositories) {
        const worst = SEVERITY_COLORS[repo.worstSeverity] || SEVERITY_COLORS.UNKNOWN;

        html += `
        <div style="margin: 0 0 20px 0; border-left: 4px solid ${worst}; background-color: ${UTILITY_COLORS.background}; padding: 14px 16px;">
            <div style="font-size: 14px; font-weight: 600; color: ${UTILITY_COLORS.text}; margin-bottom: 10px;">
                ${escapeHtml(repo.name)}
                <span style="font-weight: 400; color: ${UTILITY_COLORS.textMuted};">
                    · ${repo.vulnerabilities.length} ${repo.vulnerabilities.length === 1 ? 'finding' : 'findings'}
                </span>
            </div>`;

        for (const vuln of repo.vulnerabilities) {
            const color = SEVERITY_COLORS[vuln.severity] || SEVERITY_COLORS.UNKNOWN;
            const score = vuln.cvssScore == null ? '' : ` · CVSS ${Number(vuln.cvssScore).toFixed(1)}`;
            const via = vuln.via
                .map(v => `${escapeHtml(v.dependency)}${v.manifestFile ? ` in <code>${escapeHtml(v.manifestFile)}</code>` : ''}`)
                .join(', ');

            html += `
            <div style="padding: 10px 0; border-top: 1px solid ${UTILITY_COLORS.border};">
                <div style="font-size: 13px; margin-bottom: 4px;">
                    <span style="color: ${color}; font-weight: 600;">●</span>
                    <strong>${escapeHtml(vuln.cveId)}</strong>
                    <span style="color: ${UTILITY_COLORS.textMuted};">${vuln.severity}${score}</span>
                    ${vuln.exploited ? '<span style="color: #DC2626; font-weight: 600;"> · known exploited</span>' : ''}
                </div>
                ${vuln.title ? `<div style="font-size: 12px; color: ${UTILITY_COLORS.text}; margin-bottom: 4px;">${escapeHtml(vuln.title)}</div>` : ''}
                ${vuln.explanation ? `<div style="font-size: 12px; color: ${UTILITY_COLORS.textMuted}; margin-bottom: 4px;">${escapeHtml(vuln.explanation)}</div>` : ''}
                <div style="font-size: 11px; color: ${UTILITY_COLORS.textMuted};">Arrives through ${via}</div>
            </div>`;
        }

        html += '</div>';
    }

    return html;
}

/** A capped section: the count is the truth, the rows are a sample of it. */
function renderSection(title, subtitle, section) {
    if (section.count === 0) return '';

    let html = `<h3 style="margin: 24px 0 4px 0; font-size: 16px; color: ${UTILITY_COLORS.text};">
        ${title} — ${section.count}
    </h3>
    <p style="margin: 0 0 12px 0; font-size: 12px; color: ${UTILITY_COLORS.textMuted};">${subtitle}</p>`;

    html += renderRows(section.vulnerabilities);

    if (section.count > section.shown) {
        html += `<p style="margin: 8px 0 0 0; font-size: 12px; color: ${UTILITY_COLORS.textMuted};">
            and ${section.count - section.shown} more — the console lists them all.
        </p>`;
    }

    return html;
}

/** Dependencies a registry has moved past, per repository. */
function renderDependencies(report) {
    const { count, repositories } = report.dependencies ?? { count: 0, repositories: [] };
    if (count === 0) return '';

    let html = `<h3 style="margin: 24px 0 4px 0; font-size: 16px; color: ${UTILITY_COLORS.text};">
        Dependencies behind — ${count}
    </h3>
    <p style="margin: 0 0 12px 0; font-size: 12px; color: ${UTILITY_COLORS.textMuted};">
        The registry has a newer release than the manifest allows. Whether that upgrade is safe is a question about your code.
    </p>`;

    for (const repo of repositories) {
        const shown = repo.dependencies.slice(0, 10);

        html += `<div style="margin-bottom: 12px;">
            <div style="font-size: 13px; font-weight: 600; color: ${UTILITY_COLORS.text};">${escapeHtml(repo.name)}</div>
            <div style="font-size: 12px; color: ${UTILITY_COLORS.textMuted};">
                ${shown.map(d => `${escapeHtml(d.name)} ${escapeHtml(d.declared ?? '')} → ${escapeHtml(d.latest)}`).join('<br/>')}
                ${repo.dependencies.length > shown.length ? `<br/>and ${repo.dependencies.length - shown.length} more` : ''}
            </div>
        </div>`;
    }

    return html;
}

/** The rows of a flat section. */
function renderRows(vulns) {
    let html = '<table style="width: 100%; border-collapse: collapse;">';
    html += `
        <tr style="border-bottom: 2px solid ${UTILITY_COLORS.border}; background-color: ${UTILITY_COLORS.background};">
            <th style="padding: 10px 8px; text-align: left; font-size: 12px; color: ${UTILITY_COLORS.text};">CVE ID</th>
            <th style="padding: 10px 8px; text-align: left; font-size: 12px; color: ${UTILITY_COLORS.text};">Severity</th>
            <th style="padding: 10px 8px; text-align: left; font-size: 12px; color: ${UTILITY_COLORS.text};">CVSS</th>
            <th style="padding: 10px 8px; text-align: left; font-size: 12px; color: ${UTILITY_COLORS.text};">Source</th>
        </tr>`;

    vulns.forEach((vuln, index) => {
        const color = SEVERITY_COLORS[vuln.severity] || SEVERITY_COLORS.UNKNOWN;
        const score = vuln.cvssScore == null ? 'N/A' : Number(vuln.cvssScore).toFixed(1);

        html += `
        <tr style="border-bottom: 1px solid ${UTILITY_COLORS.border}; background-color: ${index % 2 === 0 ? '#FFFFFF' : UTILITY_COLORS.background};">
            <td style="padding: 10px 8px; border-left: 3px solid ${color}; font-size: 12px;"><strong>${escapeHtml(vuln.cveId)}</strong></td>
            <td style="padding: 10px 8px; font-size: 12px;"><span style="color: ${color};">●</span> ${vuln.severity}</td>
            <td style="padding: 10px 8px; font-size: 12px; text-align: center;">${score}</td>
            <td style="padding: 10px 8px; font-size: 12px;">${escapeHtml(vuln.source ?? 'N/A')}</td>
        </tr>`;
    });

    return html + '</table>';
}

/** Everything here is interpolated into HTML, and none of it is ours. */
function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/** The whole body, shared by both templates. */
function renderBody(report) {
    return [
        renderAffecting(report),
        renderSection(
            'Containers &amp; CI only',
            'These reach a container image or a CI action, not application code.',
            report.infrastructure
        ),
        renderSection(
            'Everything else collected',
            'Published somewhere, naming nothing this fleet ships.',
            report.other
        ),
        renderDependencies(report),
    ].join('');
}

/**
 * One CVE, one subscriber, the repositories of theirs it reaches.
 *
 * Deliberately small: this arrives the moment it is detected, and its whole job
 * is to say what happened, where, and which file carries it.
 */
export function formatRepositoryAlertHtml(vulnerability, repositories, owner) {
    const severity = (vulnerability.severity || 'UNKNOWN').toUpperCase();
    const color = SEVERITY_COLORS[severity] || SEVERITY_COLORS.UNKNOWN;
    const score = vulnerability.cvssScore == null ? '' : ` · CVSS ${Number(vulnerability.cvssScore).toFixed(1)}`;
    const explanation = vulnerability.clientExplanation || vulnerability.description || '';

    return `<!DOCTYPE html>
<html>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; background-color: ${UTILITY_COLORS.background}; margin: 0; padding: 24px;">
    <div style="max-width: 600px; margin: 0 auto; background: #FFFFFF; border-top: 4px solid ${color}; padding: 24px;">
        <p style="margin: 0 0 4px 0; font-size: 12px; color: ${UTILITY_COLORS.textMuted};">
            ${escapeHtml(owner?.name ?? 'You')} asked to hear about ${repositories.length === 1 ? 'this repository' : 'these repositories'}.
        </p>

        <h1 style="margin: 0 0 8px 0; font-size: 20px; color: ${UTILITY_COLORS.text};">
            <span style="color: ${color};">●</span> ${escapeHtml(vulnerability.cveId)}
            <span style="font-size: 14px; font-weight: 400; color: ${UTILITY_COLORS.textMuted};">${severity}${score}</span>
        </h1>

        ${vulnerability.exploited ? '<p style="margin: 0 0 12px 0; font-size: 13px; color: #DC2626; font-weight: 600;">Known to be exploited in the wild.</p>' : ''}
        ${vulnerability.title ? `<p style="margin: 0 0 12px 0; font-size: 14px; color: ${UTILITY_COLORS.text};">${escapeHtml(vulnerability.title)}</p>` : ''}
        ${explanation ? `<p style="margin: 0 0 16px 0; font-size: 13px; color: ${UTILITY_COLORS.textMuted};">${escapeHtml(explanation.slice(0, 400))}</p>` : ''}

        <h2 style="margin: 16px 0 8px 0; font-size: 14px; color: ${UTILITY_COLORS.text};">Where it reaches you</h2>
        ${repositories
            .map(
                repo => `<div style="padding: 10px 12px; margin-bottom: 8px; background: ${UTILITY_COLORS.background}; font-size: 13px;">
                    <strong>${escapeHtml(repo.name)}</strong>
                    ${repo.url ? `<br/><a href="${escapeHtml(repo.url)}" style="font-size: 12px; color: #667eea;">${escapeHtml(repo.url)}</a>` : ''}
                </div>`
            )
            .join('')}

        ${vulnerability.link ? `<p style="margin: 16px 0 0 0; font-size: 13px;"><a href="${escapeHtml(vulnerability.link)}" style="color: #667eea;">Read the advisory</a></p>` : ''}

        <p style="margin: 24px 0 0 0; font-size: 11px; color: ${UTILITY_COLORS.textMuted};">
            Atalaia reports; it never opens a pull request or changes a manifest.
        </p>
    </div>
</body>
</html>`;
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
    // The header counts the backlog by severity, which is the number that does
    // not change with the window — "113 open" reads the same on a quiet week.
    const open = report.openBySeverity ?? {};

    return {
        critical: open.CRITICAL ?? 0,
        high: open.HIGH ?? 0,
        medium: open.MEDIUM ?? 0,
        low: open.LOW ?? 0,
        // Unrated items are a real slice of the report — Ubuntu USN and the
        // CERT feeds publish no score — so they get their own count instead of
        // vanishing between the header total and the table.
        unknown: open.UNKNOWN ?? 0,
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
