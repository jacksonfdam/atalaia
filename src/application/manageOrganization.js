import logger from '../infrastructure/logger.js';
import config from '../infrastructure/config.js';
import { canEncrypt } from '../infrastructure/crypto.js';
import { GitHubProvider } from '../infrastructure/providers/githubProvider.js';
import {
    addOrganization as storeAdd,
    getOrganizationByKey as storeGet,
    getOrganizationToken as storeToken,
    listOrganizations as storeList,
    softDeleteOrganization as storeSoftDelete,
    updateOrganization as storeUpdate,
    countRepositoriesByOrg,
    present,
} from '../infrastructure/cache/organizationStore.js';

/**
 * Source-code organizations.
 *
 * Several organizations, each with its own token, is the normal case: an agency
 * has one GitHub org per client and no single token that reaches all of them.
 */

const KEY_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

/**
 * @param {{ key?: string, login: string, name?: string, token?: string }} data
 */
export async function addOrg({ key, login, name, token }) {
    if (!login) throw new Error('login is required (the GitHub organization or user)');

    const resolvedKey = (key || login).toLowerCase();
    if (!KEY_PATTERN.test(resolvedKey)) {
        throw new Error('key must be lowercase letters, digits, dot, dash or underscore');
    }

    if (token && !canEncrypt()) {
        throw new Error(
            'Cannot store the token: set TOKEN_ENCRYPTION_KEY (or API_KEY) so it can be encrypted at rest'
        );
    }

    const org = await storeAdd({ key: resolvedKey, login, name: name ?? login, token: token || null });
    logger.info({ key: resolvedKey, login }, 'Organization saved');
    return present(org);
}

/** @param {{ includeDeleted?: boolean }} [options] */
export async function listOrgs(options = {}) {
    const counts = await countRepositoriesByOrg();

    return (await storeList(options)).map(row => ({
        ...present(row),
        repositories: counts.get(row.key) ?? { total: 0, enabled: 0 },
    }));
}

export async function getOrg(key) {
    return present(await storeGet(key));
}

/**
 * @param {string} key
 * @param {{ login?: string, name?: string, enabled?: boolean, token?: string|null }} updates
 */
export async function updateOrg(key, updates) {
    if (!await storeGet(key)) throw new Error(`Organization "${key}" not found`);

    if (updates.token && !canEncrypt()) {
        throw new Error(
            'Cannot store the token: set TOKEN_ENCRYPTION_KEY (or API_KEY) so it can be encrypted at rest'
        );
    }

    return present(await storeUpdate(key, updates));
}

/**
 * Remove an organization and the repositories imported under it.
 * @param {string} key
 */
export async function removeOrg(key) {
    if (!await storeGet(key)) return null;

    const { repositories } = await storeSoftDelete(key);
    return { key, repositories };
}

/**
 * Build the read-only provider client for an organization.
 *
 * Token precedence: the organization's own token, then a matching entry in
 * config.json's `providers`, then GITHUB_TOKEN. The last two exist so a
 * deployment can keep credentials in the environment instead of the database.
 *
 * @param {string} orgKey
 * @returns {GitHubProvider}
 */
export async function providerForOrg(orgKey) {
    const token =
        (orgKey ? await storeToken(orgKey) : null) ||
        (config.providers || []).find(entry => entry.key === orgKey)?.token ||
        process.env.GITHUB_TOKEN ||
        '';

    if (!token) {
        logger.warn({ orgKey }, 'No GitHub token available; falling back to unauthenticated access');
    }

    return new GitHubProvider(token, orgKey || 'default');
}
