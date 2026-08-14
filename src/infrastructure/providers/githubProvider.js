import axios from 'axios';
import Repository from '../../domain/entities/Repository.js';
import logger from '../logger.js';

const GITHUB_API = 'https://api.github.com';
const PER_PAGE = 100;
const TIMEOUT_MS = parseInt(process.env.FEED_TIMEOUT_MS, 10) || 15000;

/** Attempts per request when GitHub is throttling, the first one included. */
const THROTTLE_ATTEMPTS = 3;

/** How long to wait before an exhausted primary quota is treated as fatal. */
const MAX_WAIT_MS = 60_000;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * How long to wait before retrying, or null when this is not throttling.
 *
 * GitHub says "slow down" in three different ways, and the difference matters:
 *
 *   Retry-After          — it told us exactly how long. Believe it.
 *   remaining: 0         — the hourly quota is gone. The reset can be most of an
 *                          hour away, which is not a wait, it is a failure: the
 *                          job should say so rather than hold a queue slot.
 *   403/429, no headers  — the secondary limit, which is about concurrency
 *                          rather than volume. Short backoff, and it clears.
 */
function throttleDelayMs(error, attempt) {
    const status = error?.response?.status;
    if (status !== 403 && status !== 429) return null;

    const headers = error.response.headers ?? {};

    const retryAfter = parseInt(headers['retry-after'], 10);
    if (!Number.isNaN(retryAfter)) {
        return retryAfter * 1000 <= MAX_WAIT_MS ? retryAfter * 1000 : null;
    }

    if (headers['x-ratelimit-remaining'] === '0') {
        const reset = parseInt(headers['x-ratelimit-reset'], 10);
        if (Number.isNaN(reset)) return null;

        const wait = reset * 1000 - Date.now();
        return wait > 0 && wait <= MAX_WAIT_MS ? wait : null;
    }

    // The secondary limit. Grows with each attempt: 1s, 4s.
    return attempt * attempt * 1000;
}

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

    /**
     * Who the token belongs to, or null when there is no token.
     * Memoised: it is asked once per listing, and the answer cannot change
     * within the life of one provider instance.
     */
    async _authenticatedLogin() {
        if (!this.token) return null;
        if (this._login !== undefined) return this._login;

        try {
            const data = await this._get(`${GITHUB_API}/user`);
            this._login = data?.login ?? null;
        } catch (error) {
            logger.warn({ err: error.message }, 'GitHub /user failed; treating the token as anonymous');
            this._login = null;
        }

        return this._login;
    }

    /**
     * What this token can actually see for a given login.
     *
     * The distinction matters: /users/:login/repos returns public repositories
     * only — a token does not widen it. Private repositories of a personal
     * account are reachable through /user/repos, and only for the account the
     * token belongs to.
     *
     * @param {string} login
     * @returns {Promise<{ kind: 'organization'|'self'|'user', visibility: 'all'|'public',
     *                     authenticatedAs: string|null }>}
     */
    async describeAccess(login) {
        const authenticatedAs = await this._authenticatedLogin();

        try {
            const data = await this._get(`${GITHUB_API}/orgs/${login}`);
            if (data?.login) {
                return {
                    kind: 'organization',
                    visibility: this.token ? 'all' : 'public',
                    authenticatedAs,
                };
            }
        } catch {
            // Not an organization — fall through to the user case.
        }

        const isSelf = Boolean(authenticatedAs) && authenticatedAs.toLowerCase() === login.toLowerCase();

        return {
            kind: isSelf ? 'self' : 'user',
            visibility: isSelf ? 'all' : 'public',
            authenticatedAs,
        };
    }

    /**
     * The single outbound request path. GET only, deliberately.
     *
     * Retries while GitHub is throttling. Scanning several repositories at once
     * runs into the secondary rate limit — which is about concurrency, not
     * volume, and clears in seconds — and dropping the repository over it loses
     * data that a short wait would have got.
     */
    async _get(url, params = {}) {
        for (let attempt = 1; ; attempt++) {
            try {
                const { data } = await axios.get(url, {
                    headers: this.headers,
                    timeout: TIMEOUT_MS,
                    params,
                });
                return data;
            } catch (error) {
                const wait = throttleDelayMs(error, attempt);

                if (wait === null || attempt >= THROTTLE_ATTEMPTS) throw error;

                logger.warn(
                    { url, attempt, waitMs: wait, status: error.response?.status },
                    'GitHub is throttling; backing off'
                );
                await sleep(wait);
            }
        }
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
            const status = error.response?.status;

            // A repository with no commits has no tree. That is genuinely empty,
            // and it is the only case where an empty list is the truth.
            if (status === 404 || status === 409) {
                logger.info({ repoUrl, status }, 'Repository has no tree to read');
                return [];
            }

            // Everything else is thrown. Swallowing it returned [] to the
            // scanner, which recorded "0 dependencies" and reported success — so
            // a whole fleet could be throttled and the sweep would say it was
            // fine, with a fraction of the dependencies and no errors.
            const detail =
                status === 403 || status === 429
                    ? `${error.message} — GitHub is refusing reads. If this is a large fleet, lower SCAN_CONCURRENCY.`
                    : error.message;

            logger.error({ repoUrl, status, err: error.message }, 'GitHub listFiles failed');
            throw new Error(`Cannot read ${owner}/${repo}: ${detail}`);
        }
    }

    async _listUserRepos(user) {
        const authenticatedAs = await this._authenticatedLogin();
        const isSelf = Boolean(authenticatedAs) && authenticatedAs.toLowerCase() === user.toLowerCase();

        // /users/:login/repos is public-only, whatever the token. The private
        // repositories of a personal account live behind /user/repos, and only
        // for the account the token belongs to.
        const url = isSelf ? `${GITHUB_API}/user/repos` : `${GITHUB_API}/users/${user}/repos`;

        if (!isSelf) {
            logger.warn(
                { user, authenticatedAs },
                'Listing a personal account that is not the token owner — only public repositories are visible'
            );
        }

        const repos = [];
        let page = 1;
        let hasMore = true;

        while (hasMore) {
            const data = await this._get(url, {
                per_page: PER_PAGE,
                page,
                // affiliation is the /user/repos spelling; type is the other's.
                ...(isSelf ? { affiliation: 'owner,collaborator,organization_member' } : { type: 'owner' }),
            });

            if (!Array.isArray(data) || data.length === 0) break;

            for (const raw of data) {
                repos.push(this._toRepository(raw));
            }

            hasMore = data.length === PER_PAGE;
            page++;
        }

        logger.info({ user, count: repos.length, isSelf }, 'Listed GitHub user repositories');
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
