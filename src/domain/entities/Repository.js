class Repository {
    constructor({
        id = null,
        name,
        url,
        provider = 'github',
        orgKey = null,
        defaultBranch = 'main',
        lastScannedAt = null,
        enabled = true,
        createdAt = null,
        updatedAt = null,
        deletedAt = null,
        primaryLanguage = null,
        languages = {},
        topics = [],
        description = null,
        archived = false,
    }) {
        this.id = id;
        this.name = name;
        this.url = url;
        this.provider = provider;
        this.orgKey = orgKey;
        this.defaultBranch = defaultBranch;
        this.lastScannedAt = lastScannedAt;
        this.enabled = enabled === true || enabled === 1;
        this.createdAt = createdAt;
        this.updatedAt = updatedAt;
        this.deletedAt = deletedAt;
        // Technologies as the hosting provider sees them. What the manifests
        // declare is tracked separately, as dependencies.
        this.primaryLanguage = primaryLanguage;
        this.languages = languages ?? {};
        this.topics = topics ?? [];
        this.description = description;
        this.archived = archived === true || archived === 1;
    }

    isDeleted() {
        return this.deletedAt !== null;
    }

    isEnabled() {
        return this.enabled && !this.isDeleted();
    }

    /**
     * Extract owner/repo from URL.
     * Supports: https://github.com/owner/repo, git@github.com:owner/repo.git
     * @returns {{ owner: string, repo: string } | null}
     */
    parseOwnerRepo() {
        const httpsMatch = this.url.match(/(?:github|gitlab|bitbucket)\.[^/]+\/([^/]+)\/([^/.]+)/);
        if (httpsMatch) return { owner: httpsMatch[1], repo: httpsMatch[2] };

        const sshMatch = this.url.match(/(?:github|gitlab|bitbucket)\.[^:]+:([^/]+)\/([^/.]+)/);
        if (sshMatch) return { owner: sshMatch[1], repo: sshMatch[2] };

        return null;
    }
}

export default Repository;
