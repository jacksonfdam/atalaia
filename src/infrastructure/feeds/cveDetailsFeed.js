import axios from 'axios';
import * as cheerio from 'cheerio';
import Vulnerability from '../../domain/entities/Vulnerability.js';
import config from '../config.js';
import logger from '../logger.js';
import { FEED_TIMEOUT_MS, withRetry } from './feedUtils.js';

function cvssToSeverity(scoreString) {
    const score = parseFloat(scoreString);
    if (isNaN(score)) return 'Unknown';
    if (score >= 9.0) return 'Critical';
    if (score >= 7.0) return 'High';
    if (score >= 4.0) return 'Medium';
    if (score >= 0.1) return 'Low';
    return 'Unknown';
}

// Replicate browser-like headers required by cvedetails.com
const CVE_DETAILS_HEADERS = {
    'Host': 'www.cvedetails.com',
    'Connection': 'keep-alive',
    'Cache-Control': 'max-age=0',
    'sec-ch-ua': '"Not=A?Brand";v="24", "Chromium";v="140"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"macOS"',
    'DNT': '1',
    'Upgrade-Insecure-Requests': '1',
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br',
    'Referer': 'https://www.cvedetails.com/',
    'Sec-Fetch-Site': 'same-origin',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-User': '?1',
    'Sec-Fetch-Dest': 'document',
    'Accept-Language': 'en-US,en;q=0.9',
    'Cookie': 'cvedconsent=1',
};

const PAGE_DELAY_MS = 3000;

/**
 * Scrape vulnerabilities from CVE Details website.
 * @returns {Promise<Vulnerability[]>}
 */
export async function fetch() {
    let currentUrl = config.feeds?.cveDetails;
    if (!currentUrl) {
        logger.warn('No CVE Details URL configured, skipping');
        return [];
    }

    return withRetry('cveDetailsFeed', async () => {
        const vulns = [];
        const maxPages = 5;
        let pageCount = 0;

        while (currentUrl && pageCount < maxPages) {
            logger.info({ page: pageCount + 1, url: currentUrl }, 'Scraping CVE Details page');
            const { data: html } = await axios.get(currentUrl, {
                headers: CVE_DETAILS_HEADERS,
                timeout: FEED_TIMEOUT_MS,
            });
            const $ = cheerio.load(html);

            const rows = $('#searchresults .border-top[data-tsvfield="cveinfo"]');
            logger.info({ rows: rows.length }, 'Found CVE Details vulnerability rows');

            rows.each((_index, element) => {
                const row = $(element);
                const cveId = row.find('h3[data-tsvfield="cveId"] a').text().trim();
                const linkHref = row.find('h3[data-tsvfield="cveId"] a').attr('href');
                const link = linkHref ? new URL(linkHref, 'https://www.cvedetails.com').toString() : null;
                const summary = row.find('.cvesummarylong').text().trim();
                const cvssScore = row.find('div[data-tsvfield="maxCvssBaseScore"] .cvssbox').text().trim();
                const publishedDate = row.find('div[data-tsvfield="publishDate"]').text().trim();
                const isExploited = row.find('div:contains("Known exploited")').length > 0;

                if (cveId && link) {
                    vulns.push(new Vulnerability({
                        cveId,
                        title: `${cveId} - ${summary.substring(0, 60)}...`,
                        description: summary,
                        publishedDate,
                        type: 'Unknown',
                        severity: cvssToSeverity(cvssScore),
                        cvssScore: parseFloat(cvssScore) || null,
                        source: 'cvedetails',
                        link,
                        exploited: isExploited,
                    }));
                }
            });

            const nextLink = $('#pagingb a:contains("»")');
            if (nextLink.length > 0) {
                const nextPath = nextLink.attr('href');
                currentUrl = new URL(nextPath, 'https://www.cvedetails.com').toString();
                // Delay between pages to avoid bot detection
                await new Promise(resolve => setTimeout(resolve, PAGE_DELAY_MS));
            } else {
                currentUrl = null;
            }
            pageCount++;
        }

        if (pageCount >= maxPages) {
            logger.warn({ maxPages }, 'Reached CVE Details max page limit');
        }

        logger.info({ count: vulns.length }, 'Successfully parsed CVE Details vulnerabilities');
        return vulns;
    });
}
