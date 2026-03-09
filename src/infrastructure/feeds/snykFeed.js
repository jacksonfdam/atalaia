import axios from 'axios';
import * as cheerio from 'cheerio';
import Vulnerability from '../../domain/entities/Vulnerability.js';
import config from '../config.js';
import logger from '../logger.js';
import { FEED_TIMEOUT_MS, USER_AGENT, withRetry } from './feedUtils.js';

const SEVERITY_MAP = { C: 'Critical', H: 'High', M: 'Medium', L: 'Low' };

/**
 * Scrape vulnerabilities from Snyk vulnerability database.
 * @returns {Promise<Vulnerability[]>}
 */
export async function fetch() {
    const baseUrl = config.feeds?.snyk;
    if (!baseUrl) {
        logger.warn('No Snyk feed URL configured, skipping');
        return [];
    }

    return withRetry('snykFeed', async () => {
        const vulns = [];
        let currentUrl = baseUrl;
        const maxPages = 5;
        let pageCount = 0;

        while (currentUrl && pageCount < maxPages) {
            logger.info({ page: pageCount + 1, url: currentUrl }, 'Scraping Snyk page');
            const { data: html } = await axios.get(currentUrl, {
                timeout: FEED_TIMEOUT_MS,
                headers: { 'User-Agent': USER_AGENT },
            });
            const $ = cheerio.load(html);

            const rows = $('table.vulns-table__table tbody tr.table__row');
            logger.info({ rows: rows.length }, 'Found Snyk vulnerability rows');

            rows.each((_index, element) => {
                const row = $(element);
                const vulnCell = row.find('td:nth-of-type(1)');
                const title = vulnCell.find('a').text().trim();
                const severityText = vulnCell.find('abbr.severity__text').text().trim();
                const linkHref = vulnCell.find('a').attr('href');
                const link = linkHref ? new URL(linkHref, baseUrl).toString() : null;
                const type = row.find('td:nth-of-type(3)').text().trim();
                const publishedDate = row.find('td:nth-of-type(4)').text().trim();
                const snykId = link ? link.split('/').pop() : 'Unknown ID';

                if (title && link) {
                    vulns.push(new Vulnerability({
                        cveId: null,
                        title,
                        description: `Snyk ID: ${snykId}`,
                        publishedDate: publishedDate || new Date().toISOString().split('T')[0],
                        type: type || 'Unknown',
                        severity: SEVERITY_MAP[severityText] || 'Unknown',
                        source: 'snyk',
                        link,
                        exploited: false,
                    }));
                }
            });

            const nextPath = $('a.next').attr('href');
            currentUrl = nextPath ? new URL(nextPath, baseUrl).toString() : null;
            pageCount++;
        }

        if (pageCount >= maxPages) {
            logger.warn({ maxPages }, 'Reached Snyk max page limit');
        }

        logger.info({ count: vulns.length }, 'Successfully parsed Snyk vulnerabilities');
        return vulns;
    });
}
