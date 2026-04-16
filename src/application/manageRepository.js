import logger from '../infrastructure/logger.js';
import {
    addRepository as storeAdd,
    softDeleteRepository as storeSoftDelete,
    getRepository as storeGet,
    getRepositoryByUrl as storeGetByUrl,
    listRepositories as storeList,
    updateRepository as storeUpdate,
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
export function addRepo(url, options = {}) {
    const normalizedUrl = url.replace(/\.git$/, '').replace(/\/$/, '');
    const provider = options.provider || detectProvider(normalizedUrl);
    const name = options.name || extractName(normalizedUrl);

    const repo = storeAdd({
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
export function removeRepo(idOrUrl) {
    const repo = typeof idOrUrl === 'number'
        ? storeGet(idOrUrl)
        : storeGetByUrl(idOrUrl);

    if (!repo) {
        logger.warn({ idOrUrl }, 'Repository not found');
        return false;
    }

    storeSoftDelete(repo.id);
    return true;
}

/**
 * List all repositories.
 * @param {{ includeDeleted?: boolean }} [options]
 * @returns {object[]}
 */
export function listRepos(options = {}) {
    return storeList(options);
}

/**
 * Get a single repository by ID.
 * @param {number} id
 * @returns {object|null}
 */
export function getRepo(id) {
    return storeGet(id);
}

/**
 * Get a single repository by URL.
 * @param {string} url
 * @returns {object|null}
 */
export function getRepoByUrl(url) {
    return storeGetByUrl(url.replace(/\.git$/, '').replace(/\/$/, ''));
}

/**
 * Restore a soft-deleted repository.
 * @param {number} id
 * @returns {boolean}
 */
export function restoreRepo(id) {
    const repo = storeGet(id);
    if (!repo) return false;
    storeUpdate(id, {}); // triggers updated_at; deleted_at cleared by addRepository on conflict
    return true;
}
