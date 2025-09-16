import fetchFeeds from "../infrastructure/fetchFeeds.js";
import notifySlack from "../infrastructure/notifySlack.js";

const sentVulnsCache = new Set();

async function monitorVulns() {
    try {
        console.log(`[atalaia] Starting vulnerability monitoring cycle...`);

        const allVulns = await fetchFeeds();

        const newVulns = allVulns.filter(vuln => !sentVulnsCache.has(vuln.link));

        if (newVulns.length === 0) {
            console.log("[atalaia] No new vulnerabilities found.");
            return;
        }

        console.log(`[atalaia] Found ${newVulns.length} new vulnerabilities to report.`);

        for (const vuln of newVulns) {
            const highlight = vuln.isCritical() || vuln.isExploited();
            // await notifySlack(vuln, highlight);

            sentVulnsCache.add(vuln.link);
        }

        console.log("[atalaia] Monitoring cycle completed.");

    } catch (error) {
        console.error("[atalaia] Error in monitorVulns:", error);
    }
}

export default monitorVulns;