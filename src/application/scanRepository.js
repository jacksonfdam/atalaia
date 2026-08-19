import logger from '../infrastructure/logger.js';
import { findParsersForFile } from '../infrastructure/parsers/parserRegistry.js';
import { resolveVendorProduct } from '../infrastructure/feeds/opencveVendorLookup.js';
import { reconcileDependencies, resolvedManifests } from './reconcileDependencies.js';
import {
    getRepository,
    replaceDependencies,
    updateRepository,
} from '../infrastructure/cache/repositoryStore.js';

/**
 * Scan a single repository for dependencies.
 *
 * @param {number} repositoryId
 * @param {import('../infrastructure/providers/githubProvider.js').GitHubProvider} provider
 * @param {{ skipVendorLookup?: boolean }} [options]
 * @returns {Promise<{ repoName: string, dependencyCount: number, ecosystems: string[], unmappedCount: number }>}
 */
export async function scanRepository(repositoryId, provider, options = {}) {
    const repo = await getRepository(repositoryId);
    if (!repo) throw new Error(`Repository ${repositoryId} not found`);
    if (repo.deleted_at) throw new Error(`Repository ${repositoryId} is deleted`);

    logger.info({ repoId: repositoryId, name: repo.name }, 'Starting repository scan');

    // 1. List all files in the repo
    const files = await provider.listFiles(repo.url, repo.default_branch);
    if (files.length === 0) {
        logger.warn({ repoId: repositoryId }, 'No files found in repository');
        return { repoName: repo.name, dependencyCount: 0, ecosystems: [], unmappedCount: 0 };
    }

    logger.info({ repoId: repositoryId, fileCount: files.length }, 'Listed repository files');

    // 2. Find manifest files and their parsers
    const parseJobs = [];
    for (const filePath of files) {
        const matches = findParsersForFile(filePath);
        for (const { parser, manifestFileName } of matches) {
            parseJobs.push({ filePath, parser, manifestFileName });
        }
    }

    if (parseJobs.length === 0) {
        logger.info({ repoId: repositoryId }, 'No manifest files found');
        await updateRepository(repositoryId, { lastScannedAt: new Date().toISOString() });
        return { repoName: repo.name, dependencyCount: 0, ecosystems: [], unmappedCount: 0 };
    }

    logger.info({ repoId: repositoryId, manifests: parseJobs.length }, 'Found manifest files');

    // 3. Fetch and parse each manifest
    const allDeps = [];
    const ecosystems = new Set();

    for (const { filePath, parser, manifestFileName } of parseJobs) {
        try {
            const content = await provider.getFileContent(repo.url, filePath, repo.default_branch);
            if (!content) continue;

            const deps = parser.parse(content, manifestFileName);
            for (const dep of deps) {
                dep.repositoryId = repositoryId;
                dep.manifestFile = filePath; // Use full path, not just filename
                allDeps.push(dep);
                ecosystems.add(dep.ecosystem);
            }

            logger.debug({ repoId: repositoryId, file: filePath, count: deps.length }, 'Parsed manifest');
        } catch (error) {
            logger.warn({ repoId: repositoryId, file: filePath, err: error.message }, 'Failed to parse manifest');
        }
    }

    // 4. A lockfile beside a manifest states what the manifest only constrained,
    //    so its rows supersede the manifest's. Before the vendor lookup, not
    //    after: that lookup is one request per dependency, and a superseded row
    //    would pay for an answer nothing goes on to store.
    const deps = reconcileDependencies(allDeps, resolvedManifests(parseJobs));
    if (deps.length !== allDeps.length) {
        logger.info(
            { repoId: repositoryId, superseded: allDeps.length - deps.length },
            'Manifest rows superseded by a lockfile'
        );
    }

    // 5. Resolve vendor/product mappings (optional, can be slow for many deps)
    let unmappedCount = deps.length;
    if (!options.skipVendorLookup) {
        for (const dep of deps) {
            try {
                const mapping = await resolveVendorProduct(dep.ecosystem, dep.name);
                if (mapping) {
                    dep.opencveVendor = mapping.vendor;
                    dep.opencveProduct = mapping.product;
                    unmappedCount--;
                }
            } catch {
                // Non-fatal — we still store the dep without mapping
            }
        }
    }

    // 6. Atomic replace in database
    await replaceDependencies(repositoryId, deps);

    // 7. Update scan timestamp
    await updateRepository(repositoryId, { lastScannedAt: new Date().toISOString() });

    const result = {
        repoName: repo.name,
        dependencyCount: deps.length,
        ecosystems: [...ecosystems],
        unmappedCount,
    };

    logger.info(result, 'Repository scan complete');
    return result;
}
