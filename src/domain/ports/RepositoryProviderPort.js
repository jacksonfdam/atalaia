/**
 * Port interface for repository hosting providers (GitHub, GitLab, Bitbucket).
 * Each provider implementation must fulfill this contract.
 */
export class RepositoryProviderPort {
    /**
     * List all repositories for an organization or user.
     * @param {string} orgOrUser - Organization or username
     * @returns {Promise<import('../entities/Repository.js').default[]>}
     */
    async listRepositories(orgOrUser) {
        throw new Error('RepositoryProviderPort.listRepositories() not implemented');
    }

    /**
     * Get the content of a single file from a repository.
     * @param {string} repoUrl - Repository URL
     * @param {string} filePath - Path to the file within the repo
     * @param {string} [ref] - Branch, tag, or commit SHA (defaults to default branch)
     * @returns {Promise<string|null>} File content as string, or null if not found
     */
    async getFileContent(repoUrl, filePath, ref) {
        throw new Error('RepositoryProviderPort.getFileContent() not implemented');
    }

    /**
     * List all file paths in a repository (flat tree).
     * @param {string} repoUrl - Repository URL
     * @param {string} [ref] - Branch, tag, or commit SHA (defaults to default branch)
     * @returns {Promise<string[]>} Array of file paths relative to repo root
     */
    async listFiles(repoUrl, ref) {
        throw new Error('RepositoryProviderPort.listFiles() not implemented');
    }
}
