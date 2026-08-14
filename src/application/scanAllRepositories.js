import logger from '../infrastructure/logger.js';
import config from '../infrastructure/config.js';
import { providerForOrg } from './manageOrganization.js';
import { listOrganizations } from '../infrastructure/cache/organizationStore.js';
import {
    addRepository,
    listRepositories,
    softDeleteRepository,
    getRepositoryByUrl,
} from '../infrastructure/cache/repositoryStore.js';
import { seedVendorProductMappings } from '../infrastructure/cache/repositoryStore.js';
import { scanRepository } from './scanRepository.js';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = path.resolve(path.dirname(__filename), '..', '..');

const DEFAULT_CONCURRENCY = 10;

/**
 * How many repositories are scanned at once.
 *
 * A caller may pass one per run (the API accepts it in the POST body); otherwise
 * SCAN_CONCURRENCY, otherwise ten. Clamped to at least one, because a zero would
 * silently scan nothing.
 *
 * @param {number|string} [requested]
 */
function resolveConcurrency(requested) {
    const value = parseInt(requested ?? process.env.SCAN_CONCURRENCY, 10);
    if (Number.isNaN(value)) return DEFAULT_CONCURRENCY;
    return Math.max(1, value);
}

/**
 * Scan all repositories from all configured providers.
 * Creates provider instances per org, discovers repos, upserts them, and scans
 * them `concurrency` at a time.
 *
 * @param {{ skipVendorLookup?: boolean, concurrency?: number,
 *           onProgress?: (event: object) => void }} [options]
 * @returns {Promise<{ totalRepos: number, totalDeps: number, errors: string[] }>}
 */
export async function scanAllRepositories(options = {}) {
    const providers = await organizationsToScan();
    // A no-op by default: a scan run from the CLI has the log for company.
    const report = options.onProgress ?? (() => {});

    report({ type: 'organizations', total: providers.length });

    if (providers.length === 0) {
        logger.warn('No organizations registered and no providers in config.json — nothing to scan');
        return { totalRepos: 0, totalDeps: 0, errors: [] };
    }

    // Seed vendor/product mappings on first run
    await seedMappingsIfNeeded();

    let totalRepos = 0;
    let totalDeps = 0;
    const errors = [];

    for (const providerConfig of providers) {
        report({ type: 'organization-start', org: providerConfig.key });

        try {
            const result = await scanProvider(providerConfig, options, report);
            totalRepos += result.repoCount;
            totalDeps += result.depCount;
            errors.push(...result.errors);
        } catch (error) {
            const msg = `Provider ${providerConfig.key}: ${error.message}`;
            logger.error({ provider: providerConfig.key, err: error }, 'Provider scan failed');
            errors.push(msg);
            report({ type: 'error', message: msg });
        }

        report({ type: 'organization-done', org: providerConfig.key });
    }

    logger.info({ totalRepos, totalDeps, errorCount: errors.length }, 'All repository scans complete');
    return { totalRepos, totalDeps, errors };
}

/**
 * Organizations to walk: the ones registered in the console, plus any entry in
 * config.json's `providers` that has no row of its own. Registered ones win, so
 * a token managed in the console is not shadowed by a stale config entry.
 */
async function organizationsToScan() {
    const registered = (await listOrganizations())
        .filter(org => org.enabled)
        .map(org => ({ key: org.key, type: org.provider, org: org.login }));

    const keys = new Set(registered.map(entry => entry.key));

    const fromConfig = (config.providers || [])
        .filter(entry => !keys.has(entry.key))
        .map(entry => ({ key: entry.key, type: entry.type ?? 'github', org: entry.org }));

    return [...registered, ...fromConfig];
}

/**
 * Scan a single provider (org).
 */
async function scanProvider(providerConfig, options, report = () => {}) {
    const { key, type, org } = providerConfig;

    logger.info({ provider: key, type, org }, 'Scanning provider');

    if (type !== 'github') {
        logger.warn({ type }, 'Unsupported provider type, skipping');
        return { repoCount: 0, depCount: 0, errors: [`Unsupported provider: ${type}`] };
    }

    // Resolves the organization's own token first, then config.json, then env.
    const provider = await providerForOrg(key);

    // 1. Discover repositories from the provider
    const remoteRepos = await provider.listRepositories(org);
    logger.info({ provider: key, count: remoteRepos.length }, 'Discovered repositories');

    // 2. Upsert repos into database
    const remoteUrls = new Set();
    for (const repo of remoteRepos) {
        remoteUrls.add(repo.url);
        await addRepository({
            name: repo.name,
            url: repo.url,
            provider: repo.provider,
            orgKey: key,
            defaultBranch: repo.defaultBranch,
            primaryLanguage: repo.primaryLanguage,
            topics: repo.topics,
            description: repo.description,
            archived: repo.archived,
            enabled: repo.enabled,
        });
    }

    // 3. Soft-delete repos that were removed from the provider
    const existingRepos = (await listRepositories()).filter(r => r.org_key === key);
    for (const existing of existingRepos) {
        if (!remoteUrls.has(existing.url)) {
            logger.info({ repoId: existing.id, url: existing.url }, 'Repository removed from provider, soft-deleting');
            await softDeleteRepository(existing.id);
        }
    }

    // 4. Scan each active repo
    const activeRepos = (await listRepositories()).filter(r => r.org_key === key && r.enabled);
    let depCount = 0;
    const errors = [];

    const concurrency = resolveConcurrency(options.concurrency);

    report({ type: 'repositories', org: key, total: activeRepos.length, concurrency });

    // Several at a time. Each repository is an independent read of somebody
    // else's API followed by a write of its own rows, so they do not contend —
    // and a sweep of four hundred repositories at ten seconds each is over an
    // hour when done one by one.
    //
    // The bound matters: parallelism does not reduce the number of GitHub
    // requests, only the rate, and a token has 5000 an hour. Ten is comfortable
    // for a fleet in the hundreds; SCAN_CONCURRENCY exists for the fleets it is
    // not comfortable for, in either direction.
    const queue = [...activeRepos];

    const runner = async () => {
        for (;;) {
            const repo = queue.shift();
            if (!repo) return;

            report({ type: 'repository-start', repository: repo.name, org: key });

            try {
                const result = await scanRepository(repo.id, provider, options);
                depCount += result.dependencyCount;
                report({ type: 'repository-done', repository: repo.name, dependencies: result.dependencyCount });
            } catch (error) {
                const msg = `${repo.name}: ${error.message}`;
                logger.error({ repoId: repo.id, name: repo.name, err: error }, 'Repository scan failed');
                errors.push(msg);
                report({ type: 'error', message: msg });
                // Counted as done either way: the progress line is "how much of
                // the sweep is behind us", not "how much of it worked".
                report({ type: 'repository-done', repository: repo.name, dependencies: 0 });
            }
        }
    };

    logger.info({ provider: key, repositories: activeRepos.length, concurrency }, 'Scanning repositories');

    // Workers pull from the shared queue rather than taking a slice each, so one
    // slow repository does not leave a worker idle while another has ten left.
    await Promise.all(Array.from({ length: Math.min(concurrency, activeRepos.length) }, runner));

    return { repoCount: activeRepos.length, depCount, errors };
}

/**
 * Seed vendor/product mappings from config file (idempotent).
 */
let seeded = false;
async function seedMappingsIfNeeded() {
    if (seeded) return;
    try {
        const seedPath = path.join(PROJECT_ROOT, 'config/vendor_product_seed.json');
        const data = readFileSync(seedPath, 'utf-8');
        const mappings = JSON.parse(data);
        await seedVendorProductMappings(mappings);
        seeded = true;
    } catch (error) {
        logger.warn({ err: error.message }, 'Failed to seed vendor/product mappings');
    }
}
