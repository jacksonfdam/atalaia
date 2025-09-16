import axios from "axios";
import config from "./config.js";

/**
 * Send vulnerability notification to Slack
 * @param {Vulnerability} vuln
 * @param {boolean} highlight  -> @channel if Critical or Exploited
 */
async function notifySlack(vuln, highlight = false) {
    if (!config.slack.webhookUrl) {
        console.error("[notifySlack] Missing Slack webhook URL");
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

    // Slack formatting
    const message = {
        text: `${highlight ? "@channel 🚨 NEW VULNERABILITY 🚨" : "New vulnerability detected"}`,
        attachments: [
            {
                color: vuln.isCritical() ? "danger" : "warning",
                title: vuln.title || "Security Vulnerability",
                title_link: vuln.link,
                fields: [
                    {
                        title: "CVE ID",
                        value: vuln.cveId || "N/A",
                        short: true
                    },
                    {
                        title: "Severity",
                        value: `${severityIcon} ${vuln.severity}`,
                        short: true
                    },
                    {
                        title: "Source",
                        value: vuln.source,
                        short: true
                    },
                    {
                        title: "Published",
                        value: vuln.publishedDate,
                        short: true
                    }
                ],
                text: vuln.description || "",
                footer: vuln.exploited ? "🔥 Known Exploited Vulnerability" : "Security Feed",
                ts: Math.floor(Date.now() / 1000)
            }
        ]
    };

    try {
        await axios.post(config.slack.webhookUrl, message);
        console.log(`[notifySlack] Sent alert for ${vuln.cveId || vuln.title}`);
    } catch (err) {
        console.error("[notifySlack] Failed to send Slack message:", err.message);
    }
}

export default notifySlack;