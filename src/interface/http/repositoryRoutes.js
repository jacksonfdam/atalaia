import express from 'express';
import { addRepo, removeRepo, listRepos, getRepo, getRepoByUrl } from '../../application/manageRepository.js';
import { scanRepository } from '../../application/scanRepository.js';
import { scanAllRepositories } from '../../application/scanAllRepositories.js';
import { getDependenciesByRepo } from '../../infrastructure/cache/repositoryStore.js';
import { GitHubProvider } from '../../infrastructure/providers/githubProvider.js';
import config from '../../infrastructure/config.js';
import logger from '../../infrastructure/logger.js';

/** Build the provider client a repository's org_key points at. */
function providerFor(repo) {
    const providerConfig = (config.providers || []).find(p => p.key === repo.org_key);
    const token = providerConfig?.token || process.env.GITHUB_TOKEN || '';
    return new GitHubProvider(token, repo.org_key || 'default');
}

function resolveRepo(idOrUrl) {
    return /^\d+$/.test(idOrUrl) ? getRepo(parseInt(idOrUrl, 10)) : getRepoByUrl(idOrUrl);
}

export function createRepositoryRoutes() {
    const router = express.Router();

    // GET /repositories
    router.get('/', (req, res) => {
        const repositories = listRepos({ includeDeleted: req.query.includeDeleted === 'true' });
        res.json({ count: repositories.length, repositories });
    });

    // POST /repositories/scan-all — declared before /:id so "scan-all" is not
    // parsed as an identifier
    router.post('/scan-all', async (req, res) => {
        try {
            const result = await scanAllRepositories({
                skipVendorLookup: req.body?.skipVendorLookup === true,
            });
            res.json(result);
        } catch (error) {
            logger.error({ err: error }, 'Scan of all repositories failed');
            res.status(500).json({ error: error.message });
        }
    });

    // POST /repositories
    router.post('/', (req, res) => {
        const { url, name, provider, orgKey, defaultBranch } = req.body ?? {};

        if (!url || typeof url !== 'string') {
            return res.status(400).json({ error: 'url is required' });
        }

        try {
            const repository = addRepo(url, { name, provider, orgKey, defaultBranch });
            res.status(201).json(repository);
        } catch (error) {
            logger.warn({ url, err: error }, 'Failed to add repository');
            res.status(400).json({ error: error.message });
        }
    });

    // GET /repositories/:idOrUrl
    router.get('/:idOrUrl', (req, res) => {
        const repository = resolveRepo(req.params.idOrUrl);
        if (!repository) return res.status(404).json({ error: 'Repository not found' });
        res.json(repository);
    });

    // DELETE /repositories/:idOrUrl — soft delete
    router.delete('/:idOrUrl', (req, res) => {
        const { idOrUrl } = req.params;
        const removed = removeRepo(/^\d+$/.test(idOrUrl) ? parseInt(idOrUrl, 10) : idOrUrl);
        if (!removed) return res.status(404).json({ error: 'Repository not found' });
        res.json({ deleted: true, repository: idOrUrl });
    });

    // GET /repositories/:idOrUrl/dependencies
    router.get('/:idOrUrl/dependencies', (req, res) => {
        const repository = resolveRepo(req.params.idOrUrl);
        if (!repository) return res.status(404).json({ error: 'Repository not found' });

        let dependencies = getDependenciesByRepo(repository.id);
        if (req.query.ecosystem) {
            const wanted = String(req.query.ecosystem).toUpperCase();
            dependencies = dependencies.filter(d => String(d.ecosystem).toUpperCase() === wanted);
        }

        res.json({ count: dependencies.length, repository, dependencies });
    });

    // POST /repositories/:idOrUrl/scan
    router.post('/:idOrUrl/scan', async (req, res) => {
        const repository = resolveRepo(req.params.idOrUrl);
        if (!repository) return res.status(404).json({ error: 'Repository not found' });

        try {
            const result = await scanRepository(repository.id, providerFor(repository), {
                skipVendorLookup: req.body?.skipVendorLookup === true,
            });
            res.json(result);
        } catch (error) {
            logger.error({ repo: repository.name, err: error }, 'Repository scan failed');
            res.status(500).json({ error: error.message });
        }
    });

    return router;
}
