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

/**
 * Scan all repositories from all configured providers.
 * Creates provider instances per org, discovers repos, upserts them, and scans each.
 *
 * @param {{ skipVendorLookup?: boolean, onProgress?: (event: object) => void }} [options]
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
    const provider = providerForOrg(key);

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

    report({ type: 'repositories', org: key, total: activeRepos.length });

    // One at a time: the log stays readable and the GitHub rate limit is never
    // the thing that breaks a scan.
    for (const repo of activeRepos) {
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
            report({ type: 'repository-done', repository: repo.name, dependencies: 0 });
        }
    }

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
