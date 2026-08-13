import logger from '../infrastructure/logger.js';
import { providerForOrg } from './manageOrganization.js';
import {
    getOrganizationByKey,
    listOrganizations,
    updateOrganization,
} from '../infrastructure/cache/organizationStore.js';
import { addRepository, getAnyRepositoryByUrl } from '../infrastructure/cache/repositoryStore.js';

/**
 * Import the repositories of an organization.
 *
 * Read-only against GitHub: the importer lists repositories and, optionally,
 * their language breakdown. Nothing is ever written back.
 */

const LANGUAGE_CONCURRENCY = 5;

/** Language breakdowns, a few repositories at a time. One request each. */
async function fetchLanguages(provider, repos) {
    const byUrl = new Map();

    for (let start = 0; start < repos.length; start += LANGUAGE_CONCURRENCY) {
        const batch = repos.slice(start, start + LANGUAGE_CONCURRENCY);

        const settled = await Promise.allSettled(
            batch.map(repo => provider.listLanguages(repo.url))
        );

        settled.forEach((result, index) => {
            if (result.status === 'fulfilled') byUrl.set(batch[index].url, result.value);
        });
    }

    return byUrl;
}

/**
 * @param {string} key Organization key
 * @param {{ withLanguages?: boolean }} [options]
 * @returns {Promise<{ org: string, login: string, found: number, imported: number,
 *                     skippedDeleted: string[], archived: number }>}
 */
export async function importOrgRepositories(key, options = {}) {
    const org = getOrganizationByKey(key);
    if (!org) throw new Error(`Organization "${key}" not found`);
    if (org.deleted_at) throw new Error(`Organization "${key}" is deleted`);

    const withLanguages = options.withLanguages !== false;
    const provider = providerForOrg(key);

    logger.info({ org: key, login: org.login }, 'Importing repositories');

    const found = await provider.listRepositories(org.login);

    // A repository the operator removed stays removed: re-importing must not
    // resurrect it behind their back.
    const skippedDeleted = [];
    const importable = found.filter(repo => {
        const existing = getAnyRepositoryByUrl(repo.url);
        if (existing?.deleted_at) {
            skippedDeleted.push(repo.name);
            return false;
        }
        return true;
    });

    const languages = withLanguages ? await fetchLanguages(provider, importable) : new Map();

    for (const repo of importable) {
        addRepository({
            name: repo.name,
            url: repo.url,
            provider: repo.provider,
            orgKey: key,
            defaultBranch: repo.defaultBranch,
            primaryLanguage: repo.primaryLanguage,
            languages: languages.get(repo.url) ?? null,
            topics: repo.topics,
            description: repo.description,
            archived: repo.archived,
            enabled: repo.enabled,
        });
    }

    updateOrganization(key, { lastImportAt: new Date().toISOString() });

    const result = {
        org: key,
        login: org.login,
        found: found.length,
        imported: importable.length,
        skippedDeleted,
        archived: importable.filter(repo => repo.archived).length,
    };

    logger.info(result, 'Repository import complete');
    return result;
}

/**
 * Import every enabled organization.
 * @param {{ withLanguages?: boolean }} [options]
 */
export async function importAllOrganizations(options = {}) {
    const orgs = listOrganizations().filter(org => org.enabled === 1);
    const results = [];
    const errors = [];

    for (const org of orgs) {
        try {
            results.push(await importOrgRepositories(org.key, options));
        } catch (error) {
            logger.error({ org: org.key, err: error.message }, 'Repository import failed');
            errors.push({ org: org.key, error: error.message });
        }
    }

    return {
        organizations: results.length,
        imported: results.reduce((total, result) => total + result.imported, 0),
        results,
        errors,
    };
}
