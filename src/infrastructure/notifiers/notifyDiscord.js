import axios from 'axios';
import logger from '../logger.js';
import { resolveDiscordConfig } from './discordConfig.js';
import { describeWebhookFailure } from './webhookError.js';
import { shortVersion } from './shortVersion.js';

const TIMEOUT_MS = 10_000;

/**
 * Discord alerts.
 *
 * An incoming webhook and an embed. No buttons: acknowledging from Discord needs
 * a registered application with an endpoint Discord can call back, which is a
 * different feature — Teams has the same gap for the same reason. The embed
 * links back to the advisory instead.
 */

// Discord takes decimal colours, not hex strings.
const SEVERITY_COLOR = {
    CRITICAL: 0xd7_3a_4a,
    HIGH: 0xff_8a_00,
    MEDIUM: 0xff_c1_07,
    LOW: 0x2e_a0_43,
};
const DEFAULT_COLOR = 0x6a_73_7d;

/**
 * Discord's limits, and they are enforced server-side: a payload over any of
 * these is rejected outright rather than trimmed, so the alert would be lost
 * rather than shortened.
 */
const LIMIT = { title: 256, description: 4096, fieldValue: 1024 };

/** @param {string} text @param {number} max */
function clamp(text, max) {
    const value = String(text ?? '');
    return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function field(name, value, inline = true) {
    return { name, value: clamp(value ?? 'N/A', LIMIT.fieldValue) || 'N/A', inline };
}

/**
 * @param {Vulnerability} vuln
 * @param {{ affectedRepositories?: object[], owners?: object[] }} [correlation]
 */
export function buildDiscordMessage(vuln, correlation = {}) {
    const severity = vuln.severity?.toUpperCase();

    const header = vuln.exploited
        ? '🚨 Exploited vulnerability'
        : severity === 'CRITICAL'
            ? '🔴 Critical vulnerability'
            : '⚠️ New vulnerability';

    // The model's paragraph when there is one, the advisory's own words when
    // there is not.
    const short = shortVersion(vuln, 600);

    const fields = [
        field('CVE', vuln.cveId),
        field('Severity', `${vuln.severity ?? 'Unknown'} (${vuln.cvssScore ?? 'N/A'})`),
        field('Source', vuln.source),
        field('Technologies', (vuln.affectedTechnologies ?? []).join(', ')),
    ];

    const repositories = (correlation.affectedRepositories ?? []).map(repo => repo.name);
    if (repositories.length > 0) {
        fields.push(
            field(
                'Affected repositories',
                `${repositories.slice(0, 5).join(', ')}${
                    repositories.length > 5 ? ` and ${repositories.length - 5} more` : ''
                }`,
                false
            )
        );
    }

    const owners = (correlation.owners ?? []).map(owner => owner.name ?? owner.email);
    if (owners.length > 0) fields.push(field('Owners', owners.join(', '), false));

    return {
        embeds: [
            {
                title: clamp(`${header} — ${vuln.title ?? vuln.cveId}`, LIMIT.title),
                description: clamp(short ? short.text : 'No description available.', LIMIT.description),
                // A url on the embed makes the title itself the link, which is
                // what a reader reaches for first.
                ...(vuln.link ? { url: vuln.link } : {}),
                color: SEVERITY_COLOR[severity] ?? DEFAULT_COLOR,
                fields,
                footer: { text: 'Atalaia' },
                ...(vuln.publishedDate instanceof Date
                    ? { timestamp: vuln.publishedDate.toISOString() }
                    : {}),
            },
        ],
    };
}

/**
 * @param {Vulnerability} vuln
 * @param {boolean} _highlight Discord has no @channel equivalent on a webhook
 * @param {{ affectedRepositories?: object[], owners?: object[] }} [correlation]
 */
export async function notifyDiscord(vuln, _highlight = false, correlation = {}) {
    const config = await resolveDiscordConfig();

    if (!config.ready) {
        logger.debug({ cveId: vuln.cveId, reason: config.reason }, 'Discord alert skipped');
        return;
    }

    try {
        await axios.post(config.webhookUrl, buildDiscordMessage(vuln, correlation), { timeout: TIMEOUT_MS });
        logger.info({ cveId: vuln.cveId }, 'Sent Discord alert');
    } catch (err) {
        // Inside a monitoring cycle: log and carry on, never reject.
        logger.error(
            { err: describeWebhookFailure(err), cveId: vuln.cveId },
            'Failed to send Discord message'
        );
    }
}

/** @returns {Promise<{ ok: boolean, error?: string }>} */
export async function sendDiscordTestMessage() {
    const config = await resolveDiscordConfig();
    if (!config.ready) return { ok: false, error: config.reason ?? 'Discord is not configured' };

    const message = {
        embeds: [
            {
                title: '✅ Atalaia is connected',
                description: 'Vulnerability alerts will arrive in this channel.',
                color: SEVERITY_COLOR.LOW,
                footer: { text: 'Atalaia' },
            },
        ],
    };

    try {
        await axios.post(config.webhookUrl, message, { timeout: TIMEOUT_MS });
        return { ok: true };
    } catch (err) {
        const reason = describeWebhookFailure(err);
        logger.warn({ err: reason }, 'Discord test message failed');
        return { ok: false, error: `Discord webhook failed — ${reason}` };
    }
}
