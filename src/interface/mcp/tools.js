import { z } from 'zod';
import fs from 'fs/promises';
import path from 'path';
import { queryByTech } from '../../application/queryByTech.js';
import { getVulnerabilityDetail } from '../../application/vulnerabilityDetail.js';
import { explainVulnerability } from '../../application/explainVulnerability.js';
import { listRepositoriesPage } from '../../application/listRepositories.js';
import { resolveRepository } from '../../application/manageRepository.js';
import { listRepositoryDependencies } from '../../application/listDependencies.js';
import { getRepositoryVulnerabilities } from '../../application/repositoryRisk.js';
import { getRepositoryTechnologies } from '../../application/repositoryTechnologies.js';
import { listOwners } from '../../application/manageOwner.js';
import { buildReport } from '../../application/buildReport.js';

/**
 * The tools an agent gets over MCP.
 *
 * One list, the way feeds and parsers are one list: a new tool is an entry
 * here, and the server, the docs and the tests all read it from this file.
 *
 * Every tool reads. The one exception is `explain_vulnerability`, which asks
 * the configured model for prose and stores the answer — declared as such in
 * its annotations so a client can tell the difference.
 */

const SEVERITY = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'];
const STATUS = ['OPEN', 'ACKNOWLEDGED', 'RESOLVED'];
const VULN_SORT = ['first_seen_at', 'last_seen_at', 'cvss_score', 'severity', 'status', 'cve_id', 'source'];
const REPO_SORT = ['name', 'primary_language', 'last_scanned_at', 'created_at', 'updated_at', 'org_key', 'exposure'];

const TECH_CONFIG_PATH = path.resolve('config/technologies.json');

/** A row, minus the prose — a list of fifty CVEs is not the place for it. */
function summarizeVulnerability(row) {
    return {
        cveId: row.cve_id,
        title: row.title,
        severity: row.severity,
        cvssScore: row.cvss_score,
        exploited: row.exploited,
        status: row.status,
        source: row.source,
        url: row.source_url,
        technologies: row.affectedTechnologies ?? [],
        firstSeenAt: row.first_seen_at,
        lastSeenAt: row.last_seen_at,
        // Whether get_vulnerability will carry prose, so an agent knows before
        // asking whether it needs explain_vulnerability first.
        explained: Boolean(row.client_explanation),
    };
}

function summarizeRepository(row) {
    return {
        id: row.id,
        name: row.name,
        url: row.url,
        organization: row.org_key,
        primaryLanguage: row.primary_language,
        defaultBranch: row.default_branch,
        enabled: row.enabled,
        archived: row.archived,
        lastScannedAt: row.last_scanned_at,
        risk: row.risk,
    };
}

function summarizeDependency(row) {
    return {
        name: row.name,
        ecosystem: row.ecosystem,
        version: row.version,
        latestVersion: row.latest_version,
        versionState: row.versionState,
        versionGap: row.versionGap,
        versionNote: row.versionNote,
        outdated: row.outdated,
        manifestFile: row.manifest_file,
        lastCheckedAt: row.latest_checked_at,
        checkError: row.latest_error,
    };
}

/**
 * An owner, minus the ways to reach them.
 *
 * The console shows an email address, a Slack id and a Telegram chat id because
 * an operator configures routing with them. An agent is answering "who owns
 * this" — a name does that, and the rest is somebody's personal data being
 * handed to a model that will put it in a context window.
 */
function summarizeOwner(row) {
    return {
        id: row.id,
        name: row.name,
        // Which channels would reach them, without saying where any of them go.
        channels: [
            row.email ? 'email' : null,
            row.slack_user_id ? 'slack' : null,
            row.telegram_chat_id ? 'telegram' : null,
        ].filter(Boolean),
        createdAt: row.created_at,
    };
}

/** Every tool that takes a repository resolves it the same way, or says so. */
async function requireRepository(idOrUrl) {
    const repository = await resolveRepository(idOrUrl);
    if (!repository) throw new Error(`Repository ${idOrUrl} not found`);
    return repository;
}

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

/**
 * @param {object} cache postgresCache module (or a compatible stub)
 * @returns {Array<{ name: string, title: string, description: string,
 *                   inputSchema: object, annotations: object,
 *                   handler: (args: object) => Promise<object> }>}
 */
export function createTools(cache) {
    return [
        {
            name: 'list_vulnerabilities',
            title: 'List vulnerabilities',
            description:
                'Search the collected vulnerabilities. Filters are combined with AND. ' +
                'relevance=affecting narrows to CVEs that name something this fleet actually ' +
                'depends on; relevance=infrastructure narrows to container images and CI actions. ' +
                'Returns a summary per CVE — call get_vulnerability for the description and correlation.',
            inputSchema: {
                status: z.enum(STATUS).optional().describe('Lifecycle state'),
                severity: z.enum(SEVERITY).optional(),
                source: z.string().optional().describe('Feed name, e.g. nvd, cisa-kev, ghsa'),
                tech: z.string().optional().describe('One affected technology, matched exactly'),
                search: z.string().optional().describe('Substring of the CVE id or the title'),
                exploited: z.boolean().optional().describe('Known exploited in the wild'),
                relevance: z.enum(['affecting', 'infrastructure']).optional(),
                sort: z.enum(VULN_SORT).optional(),
                order: z.enum(['asc', 'desc']).optional(),
                limit: z.number().int().min(1).max(200).optional().describe('Default 50, max 200'),
                offset: z.number().int().min(0).optional(),
            },
            annotations: READ_ONLY,
            handler: async args => {
                const result = await cache.query(args);
                return {
                    total: result.total,
                    count: result.vulnerabilities.length,
                    limit: result.limit,
                    offset: result.offset,
                    relevance: await cache.relevanceSummary(),
                    vulnerabilities: result.vulnerabilities.map(summarizeVulnerability),
                };
            },
        },
        {
            name: 'get_vulnerability',
            title: 'Get one vulnerability',
            description:
                'Everything known about one CVE: the full record including the stored ' +
                'explanation, a timeline reconstructed from its timestamps, which monitored ' +
                'repositories it reaches and through which dependency, and who owns them.',
            inputSchema: {
                cveId: z.string().describe('e.g. CVE-2024-0001'),
            },
            annotations: READ_ONLY,
            handler: async ({ cveId }) => {
                const detail = await getVulnerabilityDetail(cveId, cache);
                if (!detail) throw new Error(`CVE ${cveId} not found`);

                const row = detail.vulnerability;
                return {
                    vulnerability: {
                        ...summarizeVulnerability(row),
                        description: row.description,
                        explanation: row.client_explanation,
                        statusChangedBy: row.status_changed_by,
                        statusChangedAt: row.status_changed_at,
                        resolvedAt: row.resolved_at,
                    },
                    timeline: detail.timeline,
                    affectedRepositories: detail.affectedRepositories,
                    owners: detail.owners,
                };
            },
        },
        {
            name: 'explain_vulnerability',
            title: 'Explain a vulnerability',
            description:
                'Ask the model configured in Atalaia to write the plain-English explanation ' +
                'for a CVE and store it. Use it when get_vulnerability reports explained=false. ' +
                'Fails with the provider\'s own reason when no model is configured or reachable.',
            inputSchema: {
                cveId: z.string().describe('e.g. CVE-2024-0001'),
            },
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: false,
                openWorldHint: true,
            },
            handler: async ({ cveId }) => await explainVulnerability(cveId, cache),
        },
        {
            name: 'query_by_technology',
            title: 'Query by technology',
            description:
                'Which still-open CVEs list any of these technologies as affected. The direct ' +
                'question to ask about a stack Atalaia does not monitor as a repository yet. ' +
                'Matches the affected-technology list exactly, not the prose — use ' +
                'list_vulnerabilities with search for a substring of the title.',
            inputSchema: {
                technologies: z
                    .array(z.string())
                    .min(1)
                    .describe('Package, product or vendor names, e.g. ["express", "openssl"]'),
            },
            annotations: READ_ONLY,
            handler: async ({ technologies }) => {
                const results = await queryByTech(technologies, cache);
                return { count: results.length, vulnerabilities: results.map(summarizeVulnerability) };
            },
        },
        {
            name: 'get_stats',
            title: 'Get fleet statistics',
            description:
                'Counts by severity, status, source and technology, thirty days of activity, ' +
                'and how much of the database is about this fleet at all.',
            inputSchema: {},
            annotations: READ_ONLY,
            handler: async () => ({
                ...(await cache.stats()),
                relevance: await cache.relevanceSummary(),
            }),
        },
        {
            name: 'list_repositories',
            title: 'List monitored repositories',
            description:
                'The monitored repositories, each with its exposure: how many CVEs reach it, ' +
                'the worst severity among them, and whether any is exploited. exposure=affected ' +
                'narrows to the ones that are hit. A repository that has never been scanned ' +
                'reports lastScannedAt=null rather than reading as clean.',
            inputSchema: {
                search: z.string().optional().describe('Substring of the name or description'),
                org: z.string().optional().describe('Organization key'),
                language: z.string().optional().describe('Primary language'),
                enabled: z.boolean().optional(),
                archived: z.boolean().optional(),
                exposure: z.enum(['affected', 'clean', 'exploited']).optional(),
                sort: z.enum(REPO_SORT).optional(),
                order: z.enum(['asc', 'desc']).optional(),
                limit: z.number().int().min(1).max(200).optional().describe('Default 25, max 200'),
                offset: z.number().int().min(0).optional(),
            },
            annotations: READ_ONLY,
            handler: async args => {
                const page = await listRepositoriesPage(args);
                return {
                    count: page.count,
                    total: page.total,
                    limit: page.limit,
                    offset: page.offset,
                    atRisk: page.atRisk,
                    repositories: page.repositories.map(summarizeRepository),
                };
            },
        },
        {
            name: 'get_repository',
            title: 'Get one repository',
            description:
                'One repository with its languages, topics and the ecosystems found in it, ' +
                'plus how many packages each ecosystem carries.',
            inputSchema: {
                repository: z.string().describe('Numeric id or the repository URL'),
            },
            annotations: READ_ONLY,
            handler: async ({ repository }) => {
                const repo = await requireRepository(repository);
                return {
                    repository: summarizeRepository(repo),
                    ...(await getRepositoryTechnologies(repo.id)),
                };
            },
        },
        {
            name: 'list_repository_dependencies',
            title: 'List a repository\'s dependencies',
            description:
                'Every dependency parsed from a repository, with the latest published version ' +
                'where it has been looked up. versionState is behind, current, ahead or unknown ' +
                '— unknown carries the reason rather than guessing. unchecked counts the rows ' +
                'nobody has looked up yet.',
            inputSchema: {
                repository: z.string().describe('Numeric id or the repository URL'),
                ecosystem: z.string().optional().describe('e.g. NPM, GRADLE, DOCKER, GITHUB_ACTIONS'),
                outdatedOnly: z.boolean().optional().describe('Only the ones behind the latest release'),
            },
            annotations: READ_ONLY,
            handler: async ({ repository, ecosystem, outdatedOnly }) => {
                const repo = await requireRepository(repository);
                const listing = await listRepositoryDependencies(repo.id, { ecosystem, outdatedOnly });

                return {
                    repository: { id: repo.id, name: repo.name, url: repo.url },
                    count: listing.count,
                    outdated: listing.outdated,
                    unchecked: listing.unchecked,
                    groups: listing.groups,
                    dependencies: listing.dependencies.map(summarizeDependency),
                };
            },
        },
        {
            name: 'list_repository_vulnerabilities',
            title: 'List what reaches a repository',
            description:
                'Which CVEs reach one repository and through which dependency, manifest file ' +
                'and version. Resolved ones are left out unless asked for.',
            inputSchema: {
                repository: z.string().describe('Numeric id or the repository URL'),
                includeResolved: z.boolean().optional(),
            },
            annotations: READ_ONLY,
            handler: async ({ repository, includeResolved }) => {
                const repo = await requireRepository(repository);
                const result = await getRepositoryVulnerabilities(repo.id, {
                    includeResolved: includeResolved === true,
                });

                return {
                    ...result,
                    vulnerabilities: result.vulnerabilities.map(vuln => ({
                        ...summarizeVulnerability(vuln),
                        matches: vuln.matches,
                    })),
                };
            },
        },
        {
            name: 'list_owners',
            title: 'List system owners',
            description:
                'The people alerts are routed to, by name, and which channels reach them. ' +
                'Addresses and chat ids are deliberately not returned — the console has those.',
            inputSchema: {},
            annotations: READ_ONLY,
            handler: async () => {
                const owners = await listOwners({});
                return { count: owners.length, owners: owners.map(summarizeOwner) };
            },
        },
        {
            name: 'get_weekly_report',
            title: 'Get the weekly digest',
            description:
                'The digest the weekly email sends: what is affecting the fleet grouped by ' +
                'repository, infrastructure findings, everything else, and the dependencies ' +
                'that fell behind. Returns report=null with a reason when the period is empty.',
            inputSchema: {
                windowDays: z.number().int().min(1).max(365).optional().describe('Default 7'),
            },
            annotations: READ_ONLY,
            handler: async ({ windowDays }) => {
                const report = await buildReport(cache, { windowDays });
                return report
                    ? { report }
                    : { report: null, reason: 'Nothing open, nothing new and nothing behind this period' };
            },
        },
        {
            name: 'list_technologies',
            title: 'List the stack filter',
            description:
                'The static technology filter in config/technologies.json. Note that a fleet ' +
                'with scanned repositories filters on their dependencies instead, so this file ' +
                'is the fallback rather than the whole truth.',
            inputSchema: {},
            annotations: READ_ONLY,
            handler: async () => JSON.parse(await fs.readFile(TECH_CONFIG_PATH, 'utf-8')),
        },
    ];
}
