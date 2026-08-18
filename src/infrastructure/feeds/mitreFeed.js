import axios from 'axios';
import Vulnerability from '../../domain/entities/Vulnerability.js';
import logger from '../logger.js';
import { FEED_TIMEOUT_MS, USER_AGENT, cvssToSeverity, withRetry } from './feedUtils.js';

/**
 * MITRE CVE list.
 *
 * The authoritative CVE records are published as one JSON file per CVE in the
 * CVEProject/cvelistV5 repository, with cves/delta.json listing what changed in
 * the last few hours. Mirrors of that repository exist, but the upstream
 * project is the one that is actually kept current.
 *
 * delta.json only carries identifiers, so each record is fetched to get title,
 * description and score. That is one request per CVE, hence the cap.
 */
const DELTA_URL = 'https://raw.githubusercontent.com/CVEProject/cvelistV5/main/cves/delta.json';
const MAX_RECORDS = parseInt(process.env.MITRE_MAX_RECORDS, 10) || 25;
const CONCURRENCY = 5;

/** Best available CVSS base score across metric versions, newest first. */
function extractScore(metrics = []) {
    for (const key of ['cvssV4_0', 'cvssV3_1', 'cvssV3_0', 'cvssV2_0']) {
        const found = metrics.find(metric => metric[key]?.baseScore != null);
        if (found) return found[key].baseScore;
    }
    return null;
}

function toVulnerability(record) {
    const cna = record.containers?.cna ?? {};
    const cveId = record.cveMetadata?.cveId;

    const description =
        cna.descriptions?.find(entry => entry.lang?.startsWith('en'))?.value ??
        cna.descriptions?.[0]?.value ??
        'No description available.';

    const score = extractScore(cna.metrics);

    const products = (cna.affected ?? [])
        .flatMap(entry => [entry.vendor, entry.product])
        .filter(value => value && value !== 'n/a');

    return new Vulnerability({
        cveId,
        title: cna.title || description.slice(0, 160),
        description,
        publishedDate: record.cveMetadata?.datePublished ?? null,
        type: cna.problemTypes?.[0]?.descriptions?.[0]?.description ?? 'Unknown',
        severity: cvssToSeverity(score),
        source: 'mitre',
        link: `https://www.cve.org/CVERecord?id=${cveId}`,
        exploited: false,
        cvssScore: score,
        affectedTechnologies: [...new Set(products)],
    });
}

/** Fetch records a few at a time so a delta burst cannot open 70 sockets. */
async function fetchRecords(entries) {
    const records = [];

    for (let start = 0; start < entries.length; start += CONCURRENCY) {
        const batch = entries.slice(start, start + CONCURRENCY);

        const settled = await Promise.allSettled(
            batch.map(entry =>
                axios.get(entry.githubLink, {
                    timeout: FEED_TIMEOUT_MS,
                    headers: { 'User-Agent': USER_AGENT },
                })
            )
        );

        for (const [index, result] of settled.entries()) {
            if (result.status === 'fulfilled') {
                records.push(result.value.data);
            } else {
                logger.warn(
                    { cveId: batch[index].cveId, err: result.reason?.message },
                    'Failed to fetch MITRE CVE record'
                );
            }
        }
    }

    return records;
}

/**
 * @returns {Promise<Vulnerability[]>}
 */
export async function fetch() {
    return withRetry('mitreFeed', async () => {
        logger.info('Fetching MITRE CVE delta');

        const { data } = await axios.get(DELTA_URL, {
            timeout: FEED_TIMEOUT_MS,
            headers: { 'User-Agent': USER_AGENT },
        });

        const entries = (data?.new ?? []).filter(entry => entry.cveId && entry.githubLink);
        if (entries.length === 0) {
            logger.info('MITRE delta contains no new CVEs');
            return [];
        }

        const capped = entries.slice(0, MAX_RECORDS);
        if (capped.length < entries.length) {
            logger.info(
                { total: entries.length, fetched: capped.length },
                'MITRE delta truncated to the record cap'
            );
        }

        const vulns = (await fetchRecords(capped))
            .filter(record => record?.cveMetadata?.cveId)
            .map(toVulnerability);

        logger.info({ count: vulns.length }, 'Successfully parsed MITRE CVE records');
        return vulns;
    });
}
