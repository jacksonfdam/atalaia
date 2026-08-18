import axios from 'axios';
import logger from '../logger.js';
import { resolveTeamsConfig } from './teamsConfig.js';
import { describeWebhookFailure } from './webhookError.js';
import { shortVersion } from './shortVersion.js';

const TIMEOUT_MS = 10_000;

/**
 * Microsoft Teams alerts.
 *
 * Teams renders Adaptive Cards, and a Workflows (Power Automate) webhook
 * expects them wrapped in an attachment envelope. No buttons: acknowledging
 * from Teams would need an app registration and an inbound endpoint, which is a
 * different feature — the card links back to the console instead.
 */

const SEVERITY_COLOR = {
    CRITICAL: 'attention',
    HIGH: 'warning',
    MEDIUM: 'accent',
    LOW: 'good',
};

function fact(title, value) {
    return { title, value: String(value ?? 'N/A') };
}

/**
 * @param {Vulnerability} vuln
 * @param {{ affectedRepositories?: object[], owners?: object[] }} [correlation]
 */
export function buildTeamsCard(vuln, correlation = {}) {
    const header = vuln.exploited
        ? '🚨 Exploited vulnerability'
        : vuln.severity?.toUpperCase() === 'CRITICAL'
            ? '🔴 Critical vulnerability'
            : '⚠️ New vulnerability';

    // The model's paragraph when there is one, the advisory's own words when
    // there is not.
    const short = shortVersion(vuln, 400);

    const repositories = (correlation.affectedRepositories ?? []).map(repo => repo.name);
    const owners = (correlation.owners ?? []).map(owner => owner.name ?? owner.email);

    const body = [
        {
            type: 'TextBlock',
            text: header,
            weight: 'Bolder',
            size: 'Large',
            color: SEVERITY_COLOR[vuln.severity?.toUpperCase()] ?? 'default',
            wrap: true,
        },
        { type: 'TextBlock', text: vuln.title ?? vuln.cveId, wrap: true, weight: 'Bolder' },
        {
            type: 'FactSet',
            facts: [
                fact('CVE', vuln.cveId),
                fact('Severity', `${vuln.severity} (${vuln.cvssScore ?? 'N/A'})`),
                fact('Source', vuln.source),
                fact('Technologies', (vuln.affectedTechnologies ?? []).join(', ') || 'N/A'),
            ],
        },
        {
            type: 'TextBlock',
            text: short ? short.text : 'No description available.',
            wrap: true,
        },
    ];

    if (repositories.length > 0) {
        body.push({
            type: 'TextBlock',
            text: `**Affected repositories:** ${repositories.slice(0, 5).join(', ')}${
                repositories.length > 5 ? ` and ${repositories.length - 5} more` : ''
            }`,
            wrap: true,
        });
    }

    if (owners.length > 0) {
        body.push({ type: 'TextBlock', text: `**Owners:** ${owners.join(', ')}`, wrap: true, isSubtle: true });
    }

    return {
        type: 'message',
        attachments: [
            {
                contentType: 'application/vnd.microsoft.card.adaptive',
                content: {
                    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
                    type: 'AdaptiveCard',
                    version: '1.4',
                    body,
                    actions: vuln.link
                        ? [{ type: 'Action.OpenUrl', title: 'Read the advisory', url: vuln.link }]
                        : [],
                },
            },
        ],
    };
}

/**
 * @param {Vulnerability} vuln
 * @param {boolean} _highlight Teams has no @channel equivalent on a webhook
 * @param {{ affectedRepositories?: object[], owners?: object[] }} [correlation]
 */
export async function notifyTeams(vuln, _highlight = false, correlation = {}) {
    const config = await resolveTeamsConfig();

    if (!config.ready) {
        logger.debug({ cveId: vuln.cveId, reason: config.reason }, 'Teams alert skipped');
        return;
    }

    try {
        await axios.post(config.webhookUrl, buildTeamsCard(vuln, correlation), { timeout: TIMEOUT_MS });
        logger.info({ cveId: vuln.cveId }, 'Sent Teams alert');
    } catch (err) {
        // Inside a monitoring cycle: log and carry on, never reject.
        logger.error(
            { err: describeWebhookFailure(err), cveId: vuln.cveId },
            'Failed to send Teams message'
        );
    }
}

/** @returns {Promise<{ ok: boolean, error?: string }>} */
export async function sendTeamsTestMessage() {
    const config = await resolveTeamsConfig();
    if (!config.ready) return { ok: false, error: config.reason ?? 'Teams is not configured' };

    const card = {
        type: 'message',
        attachments: [
            {
                contentType: 'application/vnd.microsoft.card.adaptive',
                content: {
                    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
                    type: 'AdaptiveCard',
                    version: '1.4',
                    body: [
                        { type: 'TextBlock', text: '✅ Atalaia is connected', weight: 'Bolder', size: 'Large' },
                        { type: 'TextBlock', text: 'Vulnerability alerts will arrive in this channel.', wrap: true },
                    ],
                },
            },
        ],
    };

    try {
        await axios.post(config.webhookUrl, card, { timeout: TIMEOUT_MS });
        return { ok: true };
    } catch (err) {
        const reason = describeWebhookFailure(err);
        logger.warn({ err: reason }, 'Teams test message failed');
        return { ok: false, error: `Teams webhook failed — ${reason}` };
    }
}
