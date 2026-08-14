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

/** The organization, refusing the ones that cannot be imported from. */
async function requireOrg(key) {
    const org = await getOrganizationByKey(key);
    if (!org) throw new Error(`Organization "${key}" not found`);
    if (org.deleted_at) throw new Error(`Organization "${key}" is deleted`);
    return org;
}

/**
 * What the token can see on the provider, annotated with what Atalaia already
 * knows about each repository. Reads only — nothing is persisted.
 *
 * This is what lets an operator pick a subset instead of taking the whole
 * organization: an agency org with 300 repositories rarely wants all 300
 * scanned.
 *
 * @param {string} key Organization key
 * @returns {Promise<{ org: string, login: string, count: number, repositories: object[] }>}
 */
export async function previewOrgRepositories(key) {
    const org = await requireOrg(key);
    const provider = providerForOrg(key);

    logger.info({ org: key, login: org.login }, 'Listing repositories for selection');

    // What the token can reach for this login, so a short list can be explained
    // instead of leaving the operator to guess.
    const access = await provider.describeAccess(org.login);
    const remote = await provider.listRepositories(org.login);

    const repositories = await Promise.all(remote.map(async repo => {
        const existing = await getAnyRepositoryByUrl(repo.url);

        return {
            name: repo.name,
            url: repo.url,
            defaultBranch: repo.defaultBranch,
            primaryLanguage: repo.primaryLanguage,
            topics: repo.topics,
            description: repo.description,
            archived: repo.archived,
            // 'tracked' is already imported, 'removed' was imported and then
            // deleted here, 'new' has never been seen.
            state: existing ? (existing.deleted_at ? 'removed' : 'tracked') : 'new',
            enabled: existing ? existing.enabled : null,
        };
    }));

    return { org: key, login: org.login, count: repositories.length, access, repositories };
}

/** Match a selection entry against a repository, by full name or by URL. */
function isSelected(repo, wanted) {
    return wanted.has(repo.name.toLowerCase()) || wanted.has(repo.url.toLowerCase());
}

/**
 * @param {string} key Organization key
 * @param {{ withLanguages?: boolean, only?: string[] }} [options]
 *   `only` imports just those repositories, by full name or URL. An explicit
 *   selection also brings back one that was removed here — asking for it by
 *   name is a deliberate act, unlike a bulk import.
 * @returns {Promise<{ org: string, login: string, found: number, imported: number,
 *                     skippedDeleted: string[], notFound: string[], archived: number }>}
 */
export async function importOrgRepositories(key, options = {}) {
    const org = await requireOrg(key);

    const withLanguages = options.withLanguages !== false;
    const selection = Array.isArray(options.only) && options.only.length > 0 ? options.only : null;
    const provider = providerForOrg(key);

    logger.info({ org: key, login: org.login, selected: selection?.length ?? 'all' }, 'Importing repositories');

    const found = await provider.listRepositories(org.login);

    const skippedDeleted = [];
    let notFound = [];
    let importable;

    if (selection) {
        const wanted = new Set(selection.map(entry => String(entry).toLowerCase()));
        importable = found.filter(repo => isSelected(repo, wanted));

        const matched = new Set(
            importable.flatMap(repo => [repo.name.toLowerCase(), repo.url.toLowerCase()])
        );
        notFound = [...wanted].filter(entry => !matched.has(entry));
    } else {
        // A repository the operator removed stays removed: a bulk re-import
        // must not resurrect it behind their back.
        //
        // A loop rather than filter(): the check is a query per repository now,
        // and an async predicate hands filter() a promise — truthy for every
        // entry, so every removed repository would come straight back.
        importable = [];
        for (const repo of found) {
            const existing = await getAnyRepositoryByUrl(repo.url);
            if (existing?.deleted_at) {
                skippedDeleted.push(repo.name);
                continue;
            }
            importable.push(repo);
        }
    }

    const languages = withLanguages ? await fetchLanguages(provider, importable) : new Map();

    for (const repo of importable) {
        await addRepository({
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

    await updateOrganization(key, { lastImportAt: new Date().toISOString() });

    const result = {
        org: key,
        login: org.login,
        found: found.length,
        imported: importable.length,
        skippedDeleted,
        notFound,
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
    const orgs = (await listOrganizations()).filter(org => org.enabled);
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
