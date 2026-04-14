import axios from "axios";
import config from "./config.js";
import logger from "./logger.js";

/**
 * Send vulnerability notification to Slack using Block Kit.
 * @param {Vulnerability} vuln
 * @param {boolean} highlight  -> @channel if Critical or Exploited
 */
async function notifySlack(vuln, highlight = false) {
    if (!config.slack.webhookUrl) {
        logger.error("Missing Slack webhook URL");
        return;
    }

    // Header based on severity / exploit status
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

    // Block Kit message
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
        text: {
            type: "mrkdwn",
            text: `*What this means:*\n${explanation}`,
        },
    });

    // Exploit warning context
    if (vuln.exploited) {
        blocks.push({
            type: "context",
            elements: [{ type: "mrkdwn", text: "⚠️ Known Exploited Vulnerability — immediate action recommended" }],
        });
    }

    // Action buttons for CVEs that can be tracked
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

    // @channel in text fallback for critical/exploited vulns
    const channelTag = highlight ? "@channel " : "";
    const message = {
        text: `${channelTag}${header} — ${vuln.cveId || vuln.title}`,
        blocks,
    };

    try {
        await axios.post(config.slack.webhookUrl, message, { timeout: 10000 });
        logger.info({ cveId: vuln.cveId, title: vuln.title }, 'Sent Slack alert');
    } catch (err) {
        logger.error({ err }, 'Failed to send Slack message');
    }
}

export default notifySlack;