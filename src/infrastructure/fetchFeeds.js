import axios from "axios";
import * as cheerio from 'cheerio';
import Parser from 'rss-parser';
import Vulnerability from "../domain/Vulnerability.js";
import config from "./config.js";

const parser = new Parser();

/**
 * Fetch & normalize vulnerabilities from CISA JSON feed
 * https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json
 */
async function fetchCisaJson() {
    console.log('[fetchCisaJson] Fetching CISA KEV feed...'); // <-- LOG ADDED
    const url = config.feeds?.cisaJson;
    const vulns = [];

    if (!url) {
        console.error("[fetchCisaJson] Missing CISA feed URL in config");
        return vulns;
    }

    try {
        const { data } = await axios.get(url);

        if (!data.vulnerabilities || data.vulnerabilities.length === 0) {
            console.log('[fetchCisaJson] No vulnerabilities found in the feed.');
            return vulns;
        }

        console.log(`[fetchCisaJson] Found ${data.vulnerabilities.length} potential vulnerabilities in the feed.`);

        for (const item of data.vulnerabilities) {
            const vuln = new Vulnerability({
                cveId: item.cveID || null,
                title: item.vendorProject ? `${item.vendorProject} ${item.vulnerabilityName}` : item.vulnerabilityName,
                description: item.shortDescription || "No description available",
                publishedDate: item.dateAdded || new Date().toISOString(),
                type: "Unknown",
                severity: "Critical",
                source: "CISA Known Exploited Vulns (JSON)",
                link: item.notes || url,
                exploited: true
            });
            vulns.push(vuln);
        }

        console.log(`[fetchCisaJson] Successfully parsed ${vulns.length} vulnerabilities.`);

    } catch (err) {
        console.error("[fetchCisaJson] error:", err.message);
    }

    return vulns;
}

/**
 * Fetches and normalizes vulnerabilities from the VulDB RSS feed.
 */
async function fetchVuldbRss() {
    console.log('[fetchVuldbRss] Fetching VulDB RSS feed...');
    const url = config.feeds?.vuldbRss;
    const vulns = [];

    if (!url) {
        console.error("[fetchVuldbRss] Missing VulDB RSS feed URL in config");
        return vulns;
    }

    try {
        const feed = await parser.parseURL(url);

        if (!feed.items || feed.items.length === 0) {
            console.log('[fetchVuldbRss] No items found in the RSS feed.');
            return vulns;
        }

        console.log(`[fetchVuldbRss] Found ${feed.items.length} items in the feed.`);

        for (const item of feed.items) {
            // Extract CVE ID from the title using a regular expression
            const cveMatch = item.title.match(/(CVE-\d{4,}-\d{4,})/);
            const cveId = cveMatch ? cveMatch[0] : null;

            // Attempt to determine severity from keywords in the title
            let severity = 'Unknown';
            const titleLower = item.title.toLowerCase();
            if (titleLower.includes('critical')) severity = 'Critical';
            else if (titleLower.includes('high')) severity = 'High';
            else if (titleLower.includes('medium')) severity = 'Medium';
            else if (titleLower.includes('low')) severity = 'Low';

            const vuln = new Vulnerability({
                cveId: cveId,
                title: item.title,
                description: item.contentSnippet || 'No description available.',
                publishedDate: item.pubDate,
                type: 'Unknown', // Not available in RSS feed
                severity: severity,
                source: 'VulDB RSS Feed',
                link: item.link,
                exploited: false // Not specified in RSS feed
            });
            vulns.push(vuln);
        }

        console.log(`[fetchVuldbRss] Successfully parsed ${vulns.length} vulnerabilities.`);

    } catch (err) {
        console.error("[fetchVuldbRss] error:", err.message);
    }

    return vulns;
}

/**
 * Scrapes and normalizes vulnerabilities from Snyk's vulnerability database.
 * Handles pagination by following the "Next" link.
 */
async function fetchSnyk() {
    const vulns = [];
    let currentUrl = config.feeds?.snyk;

    if (!currentUrl) {
        console.error("[fetchSnyk] Missing Snyk feed URL in config");
        return vulns;
    }

    const maxPages = 5;
    let pageCount = 0;

    while (currentUrl && pageCount < maxPages) {
        console.log(`[fetchSnyk] Scraping page ${pageCount + 1}: ${currentUrl}`);
        try {
            const headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            };
            const { data: html } = await axios.get(currentUrl, { headers });
            const $ = cheerio.load(html);

            const rows = $('table.vulns-table__table tbody tr.table__row');
            console.log(`[fetchSnyk] Found ${rows.length} vulnerability rows on this page.`);

            rows.each((index, element) => {
                const row = $(element);

                // --- SELECTORS FIXED BASED ON YOUR HTML ---
                const vulnCell = row.find('td:nth-of-type(1)');

                // FIX 1: Get text directly from the <a> tag, not a <strong> inside it.
                const title = vulnCell.find('a').text().trim();

                // FIX 2: Target the <abbr> tag for severity.
                const severityText = vulnCell.find('abbr.severity__text').text().trim();

                const linkHref = vulnCell.find('a').attr('href');
                const link = linkHref ? new URL(linkHref, config.feeds.snyk).toString() : null;

                const type = row.find('td:nth-of-type(3)').text().trim();
                const publishedDate = row.find('td:nth-of-type(4)').text().trim();
                const snykId = link ? link.split('/').pop() : 'Unknown ID';

                console.log(`  - Row ${index + 1}: Title='${title}', Severity='${severityText}', Link='${link}'`);

                if (title && link) {
                    const vuln = new Vulnerability({
                        cveId: null,
                        title: title,
                        description: `Snyk ID: ${snykId}`,
                        publishedDate: publishedDate || new Date().toISOString().split('T')[0],
                        type: type || 'Unknown',
                        // Map single letters (H, M, C) to full words
                        severity: { 'C': 'Critical', 'H': 'High', 'M': 'Medium', 'L': 'Low' }[severityText] || 'Unknown',
                        source: 'Snyk Vulnerability Database',
                        link: link,
                        exploited: false
                    });
                    vulns.push(vuln);
                }
            });

            const nextPath = $('a.next').attr('href');
            currentUrl = nextPath ? new URL(nextPath, config.feeds.snyk).toString() : null;
            pageCount++;

        } catch (err) {
            console.error(`[fetchSnyk] Error scraping ${currentUrl}:`, err.message);
            currentUrl = null;
        }
    }

    if (pageCount >= maxPages) {
        console.log(`[fetchSnyk] Reached max page limit (${maxPages}). Stopping.`);
    }

    return vulns;
}

/**
 * Entry point - fetch all feeds
 */
async function fetchFeeds() {
    let results = [];
    console.log("[fetchFeeds] Fetching all feeds...");

    const feedPromises = [
        fetchCisaJson(),
        fetchSnyk(),
        fetchVuldbRss()
    ];

    const settledResults = await Promise.allSettled(feedPromises);

    settledResults.forEach(result => {
        if (result.status === 'fulfilled' && Array.isArray(result.value)) {
            results = results.concat(result.value);
        } else if (result.status === 'rejected') {
            console.error("[fetchFeeds] A feed fetcher failed:", result.reason);
        }
    });

    console.log(`[fetchFeeds] Total vulnerabilities fetched across all feeds: ${results.length}`);
    return results;
}


export default fetchFeeds;