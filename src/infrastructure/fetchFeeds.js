// src/infrastructure/fetchFeeds.js
import axios from "axios";
import * as cheerio from 'cheerio';
import Vulnerability from "../domain/Vulnerability.js";
import config from "./config.js";

/**
 * Fetch & normalize vulnerabilities from CISA JSON feed
 * https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json
 */
async function fetchCisaJson() {
    const url = config.feeds?.cisaJson; // optional chaining
    const vulns = [];

    if (!url) {
        console.error("[fetchCisaJson] Missing CISA feed URL in config");
        return vulns;
    }

    try {
        const { data } = await axios.get(url);

        if (!data.vulnerabilities) return vulns;

        for (const item of data.vulnerabilities) {
            const vuln = new Vulnerability({
                cveId: item.cveID || null,
                title: item.vendorProject
                    ? `${item.vendorProject} ${item.vulnerabilityName}`
                    : item.vulnerabilityName,
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
    } catch (err) {
        console.error("[fetchCisaJson] error:", err.message);
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

    console.log("[fetchFeeds] Fetching feeds...");

    //const cisaJson = await fetchCisaJson();
    // results = results.concat(cisaJson);

    const snyk = await fetchSnyk();
    results = results.concat(snyk);
    return results;
}

export default fetchFeeds;