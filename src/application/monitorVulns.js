// src/application/monitorVulns.js

import fetchFeeds from "../infrastructure/fetchFeeds.js";
import notifySlack from "../infrastructure/notifySlack.js";
import { has, add } from "../infrastructure/cache/sqliteCache.js";
import config from "../infrastructure/config.js";

function filterByTechnology(vulns) {
    const { enabled, technologies } = config.filterSettings || {};

    // If filtering is disabled or no technologies are listed, return the original list.
    if (!enabled || !technologies || technologies.length === 0) {
        return vulns;
    }

    console.log(`[atalaia] Filtering enabled. Applying filter for ${technologies.length} technologies.`);

    return vulns.filter(vuln => {
        // Create a single, lowercase string to search for keywords.
        const searchableText = `${vuln.title} ${vuln.description} ${vuln.link}`.toLowerCase();

        // Return true if any of the configured technologies are found in the text.
        return technologies.some(tech => searchableText.includes(tech));
    });
}


async function monitorVulns() {
    try {
        console.log(`[atalaia] Starting vulnerability monitoring cycle...`);

        const allVulns = await fetchFeeds();
        console.log(`[atalaia] Fetched a total of ${allVulns.length} vulnerabilities from all sources.`);

        // --- NEW: Apply the technology filter ---
        const relevantVulns = filterByTechnology(allVulns);
        if (config.filterSettings?.enabled) {
            console.log(`[atalaia] ${relevantVulns.length} vulnerabilities remain after filtering for relevant technologies.`);
        }

        // Check against the cache using the filtered list
        const newVulns = relevantVulns.filter(vuln => !has(vuln));

        if (newVulns.length === 0) {
            console.log("[atalaia] No new, relevant vulnerabilities found.");
            return;
        }

        console.log(`[atalaia] Found ${newVulns.length} new, relevant vulnerabilities to report.`);

        for (const vuln of newVulns) {
            const highlight = vuln.isCritical() || vuln.isExploited();
            await notifySlack(vuln, highlight);
            add(vuln);
        }

        console.log("[atalaia] Monitoring cycle completed.");

    } catch (error) {
        console.error("[atalaia] Error in monitorVulns:", error);
    }
}

export default monitorVulns;