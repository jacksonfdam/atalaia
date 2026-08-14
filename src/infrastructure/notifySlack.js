import axios from "axios";
import logger from "./logger.js";
import { resolveSlackConfig, describeDestination } from "./notifiers/slackConfig.js";
import { describeWebhookFailure } from "./notifiers/webhookError.js";

const SLACK_API = "https://slack.com/api/chat.postMessage";
const TIMEOUT_MS = 10_000;

/**
 * Build the Block Kit payload for a vulnerability.
 *
 * @param {Vulnerability} vuln
 * @param {boolean} highlight  -> @channel if Critical or Exploited
 * @param {{ affectedRepositories?: object[], owners?: object[] }} [correlation]
 */
export function buildVulnerabilityMessage(vuln, highlight = false, correlation = {}) {
    const header = vuln.exploited
        ? "🚨 EXPLOITED VULNERABILITY"
        : vuln.severity?.toUpperCase() === "CRITICAL"
            ? "🔴 CRITICAL VULNERABILITY"
            : "⚠️ New Vulnerability";

    // CVE field — clickable link when source URL available
    const cveDisplay = vuln.link && vuln.cveId
        ? `<${vuln.link}|${vuln.cveId}>`
        : vuln.cveId || "N/A";

    const technologies = (vuln.affectedTechnologies || []).join(", ") || "N/A";

    const blocks = [
        {
            type: "header",
            text: { type: "plain_text", text: header, emoji: true },
        },
        {
            type: "section",
            fields: [
                { type: "mrkdwn", text: `*CVE:*\n${cveDisplay}` },
                { type: "mrkdwn", text: `*Severity:*\n${vuln.severity} (${vuln.cvssScore || "N/A"})` },
                { type: "mrkdwn", text: `*Technologies:*\n${technologies}` },
                { type: "mrkdwn", text: `*Source:*\n${vuln.source}` },
            ],
        },
    ];

    // Client explanation from LLM, fallback to truncated description
    const explanation = vuln.clientExplanation
        || (vuln.description
            ? vuln.description.substring(0, 300) + (vuln.description.length > 300 ? "..." : "")
            : "_No description available_");

    blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: `*What this means:*\n${explanation}` },
    });

    // What of ours it touches. This is the difference between "a CVE exists"
    // and "a CVE is in something you ship", so it goes in the message.
    const repositories = correlation.affectedRepositories ?? [];
    if (repositories.length > 0) {
        const names = repositories
            .slice(0, 5)
            .map(repo => (repo.url ? `<${repo.url}|${repo.name}>` : repo.name))
            .join(", ");
        const rest = repositories.length > 5 ? ` and ${repositories.length - 5} more` : "";

        blocks.push({
            type: "section",
            text: { type: "mrkdwn", text: `*Affected repositories:*\n${names}${rest}` },
        });
    }

    const owners = correlation.owners ?? [];
    if (owners.length > 0) {
        const mentions = owners
            .map(owner => (owner.slack_user_id ? `<@${owner.slack_user_id}>` : owner.name))
            .join(", ");

        blocks.push({
            type: "context",
            elements: [{ type: "mrkdwn", text: `Owners: ${mentions}` }],
        });
    }

    if (vuln.exploited) {
        blocks.push({
            type: "context",
            elements: [{ type: "mrkdwn", text: "⚠️ Known Exploited Vulnerability — immediate action recommended" }],
        });
    }

    if (vuln.cveId) {
        blocks.push({
            type: "actions",
            elements: [
                {
                    type: "button",
                    text: { type: "plain_text", text: "✅ Acknowledge", emoji: true },
                    action_id: "ack_vuln",
                    value: vuln.cveId,
                    style: "primary",
                },
                {
                    type: "button",
                    text: { type: "plain_text", text: "🔒 Resolve", emoji: true },
                    action_id: "resolve_vuln",
                    value: vuln.cveId,
                    style: "danger",
                },
            ],
        });
    }

    const channelTag = highlight ? "@channel " : "";

    return {
        text: `${channelTag}${header} — ${vuln.cveId || vuln.title}`,
        blocks,
    };
}

/**
 * Deliver one message through whichever transport is configured.
 *
 * @param {object} config Resolved Slack configuration
 * @param {object} message Block Kit payload
 * @param {string} [destination] Overrides the configured one (bot mode only)
 */
export async function deliver(config, message, destination) {
    if (config.mode === 'bot') {
        const channel = describeDestination(destination ?? config.destination).value;
        if (!channel) throw new Error('No channel or user to post to');

        const { data } = await axios.post(
            SLACK_API,
            { channel, ...message },
            {
                timeout: TIMEOUT_MS,
                headers: {
                    Authorization: `Bearer ${config.botToken}`,
                    'Content-Type': 'application/json; charset=utf-8',
                },
            }
        );

        // chat.postMessage answers 200 with ok:false on failure, so the HTTP
        // status alone would report a silent drop as a success.
        if (!data.ok) throw new Error(`Slack rejected the message: ${data.error}`);
        return { channel: data.channel ?? channel, ts: data.ts };
    }

    if (!config.webhookUrl) throw new Error('No webhook URL configured');

    try {
        await axios.post(config.webhookUrl, message, { timeout: TIMEOUT_MS });
    } catch (err) {
        // Slack's reason for refusing lives in the response body, not in the
        // status line, so it has to be lifted out or the operator is left with
        // "status code 404" and nothing to act on.
        throw new Error(`Slack webhook failed — ${describeWebhookFailure(err)}`);
    }

    return { channel: 'webhook' };
}

/**
 * Send a vulnerability notification to Slack.
 *
 * @param {Vulnerability} vuln
 * @param {boolean} highlight
 * @param {{ affectedRepositories?: object[], owners?: object[] }} [correlation]
 */
async function notifySlack(vuln, highlight = false, correlation = {}) {
    const config = await resolveSlackConfig();

    if (!config.ready) {
        logger.debug({ cveId: vuln.cveId, reason: config.reason }, 'Slack alert skipped');
        return;
    }

    const message = buildVulnerabilityMessage(vuln, highlight, correlation);

    try {
        await deliver(config, message);
        logger.info({ cveId: vuln.cveId, mode: config.mode }, 'Sent Slack alert');
    } catch (err) {
        logger.error({ err, cveId: vuln.cveId, mode: config.mode }, 'Failed to send Slack message');
        return;
    }

    // Direct messages to the people responsible, when asked for. Only a bot
    // token can do this: an incoming webhook is bound to its own channel.
    if (!config.notifyOwners || config.mode !== 'bot') return;

    const owners = (correlation.owners ?? []).filter(owner => owner.slack_user_id);

    for (const owner of owners) {
        try {
            await deliver(config, message, owner.slack_user_id);
            logger.info({ cveId: vuln.cveId, owner: owner.email }, 'Sent Slack DM to owner');
        } catch (err) {
            logger.warn({ err, owner: owner.email }, 'Failed to DM owner');
        }
    }
}

/**
 * Post a message the operator asked for, reporting what happened.
 * @returns {Promise<{ ok: boolean, mode?: string, channel?: string, error?: string }>}
 */
export async function sendTestMessage() {
    const config = await resolveSlackConfig();
    if (!config.ready) {
        return { ok: false, error: config.reason ?? 'Slack is not configured' };
    }

    const message = {
        text: 'Atalaia test message',
        blocks: [
            {
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: '✅ *Atalaia is connected.*\nVulnerability alerts will arrive here.',
                },
            },
        ],
    };

    try {
        const result = await deliver(config, message);
        return { ok: true, mode: config.mode, channel: result.channel };
    } catch (err) {
        logger.warn({ err, mode: config.mode }, 'Slack test message failed');
        return { ok: false, mode: config.mode, error: err.message };
    }
}

export default notifySlack;
