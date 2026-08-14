import logger from '../infrastructure/logger.js';
import {
    addRepository as storeAdd,
    softDeleteRepository as storeSoftDelete,
    getRepository as storeGet,
    getRepositoryByUrl as storeGetByUrl,
    getAnyRepositoryByUrl as storeGetAnyByUrl,
    listRepositories as storeList,
    updateRepository as storeUpdate,
    restoreRepository as storeRestore,
} from '../infrastructure/cache/repositoryStore.js';

/**
 * Detect provider from URL.
 * @param {string} url
 * @returns {string}
 */
function detectProvider(url) {
    if (url.includes('github.com')) return 'github';
    if (url.includes('gitlab.com') || url.includes('gitlab')) return 'gitlab';
    if (url.includes('bitbucket.org') || url.includes('bitbucket')) return 'bitbucket';
    return 'github'; // default
}

/**
 * Extract a human-readable name from a repo URL.
 * @param {string} url
 * @returns {string}
 */
function extractName(url) {
    const match = url.match(/(?:github|gitlab|bitbucket)\.[^/]+\/([^/]+\/[^/.]+)/);
    return match ? match[1] : url;
}

/**
 * Add a repository.
 * @param {string} url
 * @param {{ name?: string, provider?: string, orgKey?: string, defaultBranch?: string }} [options]
 * @returns {object}
 */
export async function addRepo(url, options = {}) {
    const normalizedUrl = url.replace(/\.git$/, '').replace(/\/$/, '');
    const provider = options.provider || detectProvider(normalizedUrl);
    const name = options.name || extractName(normalizedUrl);

    const repo = await storeAdd({
        name,
        url: normalizedUrl,
        provider,
        orgKey: options.orgKey || null,
        defaultBranch: options.defaultBranch || 'main',
    });

    logger.info({ url: normalizedUrl, name }, 'Repository added');
    return repo;
}

/**
 * Soft-delete a repository by ID or URL.
 * @param {string|number} idOrUrl
 * @returns {boolean}
 */
export async function removeRepo(idOrUrl) {
    const repo = typeof idOrUrl === 'number'
        ? await storeGet(idOrUrl)
        : await storeGetByUrl(idOrUrl);

    if (!repo) {
        logger.warn({ idOrUrl }, 'Repository not found');
        return false;
    }

    await storeSoftDelete(repo.id);
    return true;
}

/**
 * List all repositories.
 * @param {{ includeDeleted?: boolean }} [options]
 * @returns {object[]}
 */
export async function listRepos(options = {}) {
    return await storeList(options);
}

/**
 * Get a single repository by ID.
 * @param {number} id
 * @returns {object|null}
 */
export async function getRepo(id) {
    return await storeGet(id);
}

/**
 * Get a single repository by URL.
 * @param {string} url
 * @returns {object|null}
 */
export async function getRepoByUrl(url) {
    return await storeGetByUrl(url.replace(/\.git$/, '').replace(/\/$/, ''));
}

/**
 * Restore a soft-deleted repository, together with its dependencies.
 * @param {number|string} idOrUrl
 * @returns {object|null}
 */
export async function restoreRepo(idOrUrl) {
    const repo = typeof idOrUrl === 'number' ? await storeGet(idOrUrl) : await storeGetAnyByUrl(idOrUrl);
    if (!repo) return null;

    return await storeRestore(repo.id);
}

/**
 * Turn scanning and correlation on or off for a repository, without losing what
 * has already been collected about it.
 *
 * @param {number} id
 * @param {boolean} enabled
 * @returns {object|null}
 */
export async function setRepoEnabled(id, enabled) {
    const repo = await storeGet(id);
    if (!repo) return null;

    await storeUpdate(id, { enabled });
    logger.info({ id, enabled }, 'Repository enablement changed');
    return await storeGet(id);
}
