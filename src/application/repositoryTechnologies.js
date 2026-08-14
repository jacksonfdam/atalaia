import logger from '../infrastructure/logger.js';
import { providerForOrg } from './manageOrganization.js';
import {
    getRepository,
    getDependenciesByRepo,
    updateRepository,
} from '../infrastructure/cache/repositoryStore.js';

/**
 * What a repository is built with.
 *
 * Two independent signals, kept apart because they answer different questions:
 * languages and topics come from the hosting provider and describe the code,
 * while ecosystems come from the manifests found by a scan and describe what it
 * depends on. A repository can report "TypeScript" and still have its risk sit
 * in a Dockerfile.
 */

/**
 * @param {number} repositoryId
 * @returns {object|null}
 */
export async function getRepositoryTechnologies(repositoryId) {
    const repo = await getRepository(repositoryId);
    if (!repo) return null;

    // jsonb, so the driver has already parsed it.
    const languageBytes = repo.languages ?? {};
    const totalBytes = Object.values(languageBytes).reduce((total, bytes) => total + bytes, 0);

    const languages = Object.entries(languageBytes)
        .sort((a, b) => b[1] - a[1])
        .map(([name, bytes]) => ({
            name,
            bytes,
            share: totalBytes > 0 ? Math.round((bytes / totalBytes) * 1000) / 10 : null,
        }));

    const dependencies = await getDependenciesByRepo(repositoryId);
    const byEcosystem = new Map();

    for (const dependency of dependencies) {
        const current = byEcosystem.get(dependency.ecosystem) ?? { name: dependency.ecosystem, packages: 0 };
        current.packages += 1;
        byEcosystem.set(dependency.ecosystem, current);
    }

    return {
        repository: { id: repo.id, name: repo.name, url: repo.url },
        primaryLanguage: repo.primary_language,
        languages,
        topics: repo.topics ?? [],
        ecosystems: [...byEcosystem.values()].sort((a, b) => b.packages - a.packages),
        dependencyCount: dependencies.length,
        lastScannedAt: repo.last_scanned_at,
    };
}

/**
 * Re-read the language breakdown from the provider.
 * One read-only request; the manifest side is refreshed by a repository scan.
 *
 * @param {number} repositoryId
 */
export async function refreshRepositoryLanguages(repositoryId) {
    const repo = await getRepository(repositoryId);
    if (!repo) throw new Error(`Repository ${repositoryId} not found`);

    const provider = providerForOrg(repo.org_key);
    const languages = await provider.listLanguages(repo.url);

    // The endpoint's ordering is not part of its contract, so the primary
    // language is the one with the most bytes rather than the first key.
    const primaryLanguage =
        Object.entries(languages).sort((a, b) => b[1] - a[1])[0]?.[0] ?? repo.primary_language;

    await updateRepository(repositoryId, { languages, primaryLanguage });

    logger.info({ repoId: repositoryId, languages: Object.keys(languages).length }, 'Languages refreshed');
    return await getRepositoryTechnologies(repositoryId);
}
