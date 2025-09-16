// src/application/monitorVulns.js

import fetchFeeds from "../infrastructure/fetchFeeds.js";
import notifySlack from "../infrastructure/notifySlack.js";
import { loadCache, saveCache, has, add } from "../infrastructure/cache.js";

// Load the cache once on application startup
loadCache();

async function monitorVulns() {
    try {
        console.log(`[atalaia] Starting vulnerability monitoring cycle...`);

        const allVulns = await fetchFeeds();

        const newVulns = allVulns.filter(vuln => !has(vuln));

        if (newVulns.length === 0) {
            console.log("[atalaia] No new vulnerabilities found.");
            return;
        }

        console.log(`[atalaia] Found ${newVulns.length} new vulnerabilities to report.`);

        for (const vuln of newVulns) {
            const highlight = vuln.isCritical() || vuln.isExploited();
            // await notifySlack(vuln, highlight);
            add(vuln);
        }

        // Save the updated cache to disk after the cycle is complete
        saveCache();

        console.log("[atalaia] Monitoring cycle completed.");

    } catch (error) {
        console.error("[atalaia] Error in monitorVulns:", error);
    }
}

export default monitorVulns;