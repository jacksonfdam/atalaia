import axios from 'axios';
import Repository from '../../domain/entities/Repository.js';
import logger from '../logger.js';

const GITHUB_API = 'https://api.github.com';
const PER_PAGE = 100;
const TIMEOUT_MS = parseInt(process.env.FEED_TIMEOUT_MS, 10) || 15000;

/**
 * GitHub repository provider.
 * One instance per organization (each with its own token).
 *
 * Read-only by construction: every request in this class goes through _get(),
 * which is the only place an HTTP method is chosen. Atalaia inspects source code
 * and never writes anything back to GitHub — no issues, no commits, no status
 * checks — so adding a write helper here would be the bug, not the feature.
 */
export class GitHubProvider {
    /**
     * @param {string} token - GitHub personal access token or fine-grained token
     * @param {string} orgKey - Config key identifying this org
     */
    constructor(token, orgKey) {
        this.token = token;
        this.orgKey = orgKey;
        this.headers = {
            'Accept': 'application/vnd.github+json',
            'User-Agent': 'Atalaia/1.0',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        };
    }

    /** The single outbound request path. GET only, deliberately. */
    async _get(url, params = {}) {
        const { data } = await axios.get(url, {
            headers: this.headers,
            timeout: TIMEOUT_MS,
            params,
        });
        return data;
    }

    /** Map a GitHub repository object onto the domain entity. */
    _toRepository(raw) {
        return new Repository({
            name: raw.full_name || raw.name,
            url: raw.html_url,
            provider: 'github',
            orgKey: this.orgKey,
            defaultBranch: raw.default_branch || 'main',
            primaryLanguage: raw.language ?? null,
            topics: raw.topics ?? [],
            description: raw.description ?? null,
            archived: raw.archived === true,
            // An archived repository is imported but left switched off: it is
            // still worth knowing it exists, and it is not worth scanning.
            enabled: raw.archived !== true && raw.disabled !== true,
        });
    }

    /**
     * List all repositories for an organization or user.
     * @param {string} orgOrUser
     * @returns {Promise<Repository[]>}
     */
    async listRepositories(orgOrUser) {
        const repos = [];
        let page = 1;
        let hasMore = true;

        while (hasMore) {
            try {
                const data = await this._get(`${GITHUB_API}/orgs/${orgOrUser}/repos`, {
                    per_page: PER_PAGE,
                    page,
                    type: 'all',
                });

                if (!Array.isArray(data) || data.length === 0) {
                    hasMore = false;
                    break;
                }

                for (const raw of data) {
                    repos.push(this._toRepository(raw));
                }

                hasMore = data.length === PER_PAGE;
                page++;
            } catch (error) {
                if (error.response?.status === 404 && page === 1) {
                    // Not an org — the login may belong to a user account.
                    return this._listUserRepos(orgOrUser);
                }
                logger.error({ org: orgOrUser, page, err: error.message }, 'GitHub listRepositories failed');
                throw error;
            }
        }

        logger.info({ org: orgOrUser, count: repos.length }, 'Listed GitHub repositories');
        return repos;
    }

    /**
     * Language breakdown of a repository, in bytes of source per language.
     * @param {string} repoUrl
     * @returns {Promise<Record<string, number>>}
     */
    async listLanguages(repoUrl) {
        const { owner, repo } = parseGitHubUrl(repoUrl);
        if (!owner || !repo) return {};

        try {
            const data = await this._get(`${GITHUB_API}/repos/${owner}/${repo}/languages`);
            return data && typeof data === 'object' ? data : {};
        } catch (error) {
            logger.warn({ repoUrl, err: error.message }, 'GitHub listLanguages failed');
            return {};
        }
    }

    /**
     * Get content of a single file from a repository.
     * @param {string} repoUrl - e.g. "https://github.com/owner/repo"
     * @param {string} filePath - e.g. "package.json"
     * @param {string} [ref] - Branch/tag/SHA
     * @returns {Promise<string|null>}
     */
    async getFileContent(repoUrl, filePath, ref) {
        const { owner, repo } = parseGitHubUrl(repoUrl);
        if (!owner || !repo) return null;

        try {
            const data = await this._get(
                `${GITHUB_API}/repos/${owner}/${repo}/contents/${filePath}`,
                ref ? { ref } : {}
            );

            if (data.encoding === 'base64' && data.content) {
                return Buffer.from(data.content, 'base64').toString('utf-8');
            }

            // For files > 1MB, use the blob API
            if (data.size > 1_000_000 && data.sha) {
                return this._getBlobContent(owner, repo, data.sha);
            }

            return data.content || null;
        } catch (error) {
            if (error.response?.status === 404) return null;
            logger.warn({ repoUrl, filePath, err: error.message }, 'GitHub getFileContent failed');
            return null;
        }
    }

    /**
     * List all file paths in a repository using the Git tree API (single request).
     * @param {string} repoUrl
     * @param {string} [ref]
     * @returns {Promise<string[]>}
     */
    async listFiles(repoUrl, ref) {
        const { owner, repo } = parseGitHubUrl(repoUrl);
        if (!owner || !repo) return [];

        try {
            const branch = ref || 'HEAD';
            const data = await this._get(
                `${GITHUB_API}/repos/${owner}/${repo}/git/trees/${branch}`,
                { recursive: 1 }
            );

            if (!data.tree || !Array.isArray(data.tree)) return [];

            return data.tree
                .filter(item => item.type === 'blob')
                .map(item => item.path);
        } catch (error) {
            logger.error({ repoUrl, err: error.message }, 'GitHub listFiles failed');
            return [];
        }
    }

    async _listUserRepos(user) {
        const repos = [];
        let page = 1;
        let hasMore = true;

        while (hasMore) {
            const data = await this._get(`${GITHUB_API}/users/${user}/repos`, {
                per_page: PER_PAGE,
                page,
                type: 'owner',
            });

            if (!Array.isArray(data) || data.length === 0) break;

            for (const raw of data) {
                repos.push(this._toRepository(raw));
            }

            hasMore = data.length === PER_PAGE;
            page++;
        }

        logger.info({ user, count: repos.length }, 'Listed GitHub user repositories');
        return repos;
    }

    async _getBlobContent(owner, repo, sha) {
        try {
            const data = await this._get(`${GITHUB_API}/repos/${owner}/${repo}/git/blobs/${sha}`);
            if (data.encoding === 'base64' && data.content) {
                return Buffer.from(data.content, 'base64').toString('utf-8');
            }
            return null;
        } catch {
            return null;
        }
    }
}

/**
 * Parse a GitHub URL into owner/repo.
 * @param {string} url
 * @returns {{ owner: string, repo: string }}
 */
export function parseGitHubUrl(url) {
    const match = url.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
    if (!match) return { owner: '', repo: '' };
    return { owner: match[1], repo: match[2] };
}
