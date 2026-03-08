import axios from "axios";
import config from "./config.js";
import logger from "./logger.js";

/**
 * Send vulnerability notification to Slack
 * @param {Vulnerability} vuln
 * @param {boolean} highlight  -> @channel if Critical or Exploited
 */
async function notifySlack(vuln, highlight = false) {
    if (!config.slack.webhookUrl) {
        logger.error("Missing Slack webhook URL");
        return;
    }

    // Emoji for severity levels
    const severityIcons = {
        low: "🟢",
        medium: "🟡",
        high: "🟠",
        critical: "🔴🚨"
    };

    const sevKey = vuln.severity.toLowerCase();
    const severityIcon = severityIcons[sevKey] || "❓";

    // Block Kit message with action buttons
    const blocks = [
        {
            type: "header",
            text: {
                type: "plain_text",
                text: highlight ? "NEW VULNERABILITY" : "Vulnerability Detected",
            },
        },
        {
            type: "section",
            text: {
                type: "mrkdwn",
                text: `*<${vuln.link}|${vuln.title || "Security Vulnerability"}>*`,
            },
        },
        {
            type: "section",
            fields: [
                { type: "mrkdwn", text: `*CVE ID:*\n${vuln.cveId || "N/A"}` },
                { type: "mrkdwn", text: `*Severity:*\n${severityIcon} ${vuln.severity}` },
                { type: "mrkdwn", text: `*Source:*\n${vuln.source}` },
                { type: "mrkdwn", text: `*Published:*\n${vuln.publishedDate}` },
            ],
        },
        {
            type: "section",
            text: {
                type: "mrkdwn",
                text: vuln.description
                    ? vuln.description.substring(0, 300) + (vuln.description.length > 300 ? "..." : "")
                    : "_No description_",
            },
        },
    ];

    // Add exploit warning if applicable
    if (vuln.exploited) {
        blocks.push({
            type: "context",
            elements: [{ type: "mrkdwn", text: "Known Exploited Vulnerability" }],
        });
    }

    // Add action buttons for CVEs that can be tracked
    if (vuln.cveId) {
        blocks.push({
            type: "actions",
            elements: [
                {
                    type: "button",
                    text: { type: "plain_text", text: "Acknowledge" },
                    action_id: "ack_vuln",
                    value: vuln.cveId,
                    style: "primary",
                },
                {
                    type: "button",
                    text: { type: "plain_text", text: "Resolve" },
                    action_id: "resolve_vuln",
                    value: vuln.cveId,
                    style: "danger",
                },
            ],
        });
    }

    const message = {
        text: `${highlight ? "@channel " : ""}${vuln.cveId || vuln.title}`,
        blocks,
    };

    try {
        await axios.post(config.slack.webhookUrl, message);
        logger.info({ cveId: vuln.cveId, title: vuln.title }, 'Sent Slack alert');
    } catch (err) {
        logger.error({ err }, 'Failed to send Slack message');
    }
}

export default notifySlack;