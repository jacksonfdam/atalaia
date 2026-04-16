import axios from 'axios';
import Repository from '../../domain/entities/Repository.js';
import logger from '../logger.js';

const GITHUB_API = 'https://api.github.com';
const PER_PAGE = 100;
const TIMEOUT_MS = parseInt(process.env.FEED_TIMEOUT_MS, 10) || 15000;

/**
 * GitHub repository provider.
 * One instance per organization (each with its own token).
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
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'Atalaia/1.0',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        };
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
                // Try org endpoint first, fall back to user
                const url = await this._resolveReposUrl(orgOrUser, page);
                const { data } = await axios.get(url, {
                    headers: this.headers,
                    timeout: TIMEOUT_MS,
                    params: { per_page: PER_PAGE, page },
                });

                if (!Array.isArray(data) || data.length === 0) {
                    hasMore = false;
                    break;
                }

                for (const r of data) {
                    if (r.archived || r.disabled) continue;

                    repos.push(new Repository({
                        name: r.full_name || r.name,
                        url: r.html_url,
                        provider: 'github',
                        orgKey: this.orgKey,
                        defaultBranch: r.default_branch || 'main',
                    }));
                }

                hasMore = data.length === PER_PAGE;
                page++;
            } catch (error) {
                if (error.response?.status === 404 && page === 1) {
                    // Try user endpoint on org 404
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
            const params = ref ? { ref } : {};
            const { data } = await axios.get(
                `${GITHUB_API}/repos/${owner}/${repo}/contents/${filePath}`,
                { headers: this.headers, timeout: TIMEOUT_MS, params }
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
            const { data } = await axios.get(
                `${GITHUB_API}/repos/${owner}/${repo}/git/trees/${branch}`,
                {
                    headers: this.headers,
                    timeout: TIMEOUT_MS,
                    params: { recursive: 1 },
                }
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

    async _resolveReposUrl(orgOrUser, page) {
        return `${GITHUB_API}/orgs/${orgOrUser}/repos`;
    }

    async _listUserRepos(user) {
        const repos = [];
        let page = 1;
        let hasMore = true;

        while (hasMore) {
            const { data } = await axios.get(`${GITHUB_API}/users/${user}/repos`, {
                headers: this.headers,
                timeout: TIMEOUT_MS,
                params: { per_page: PER_PAGE, page, type: 'owner' },
            });

            if (!Array.isArray(data) || data.length === 0) break;

            for (const r of data) {
                if (r.archived || r.disabled) continue;
                repos.push(new Repository({
                    name: r.full_name || r.name,
                    url: r.html_url,
                    provider: 'github',
                    orgKey: this.orgKey,
                    defaultBranch: r.default_branch || 'main',
                }));
            }

            hasMore = data.length === PER_PAGE;
            page++;
        }

        logger.info({ user, count: repos.length }, 'Listed GitHub user repositories');
        return repos;
    }

    async _getBlobContent(owner, repo, sha) {
        try {
            const { data } = await axios.get(
                `${GITHUB_API}/repos/${owner}/${repo}/git/blobs/${sha}`,
                { headers: this.headers, timeout: TIMEOUT_MS }
            );
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
