import express from 'express';
import {
    addRepo,
    removeRepo,
    listRepos,
    getRepo,
    getRepoByUrl,
    restoreRepo,
    setRepoEnabled,
} from '../../application/manageRepository.js';
import { scanRepository } from '../../application/scanRepository.js';
import { scanAllRepositories } from '../../application/scanAllRepositories.js';
import { providerForOrg } from '../../application/manageOrganization.js';
import {
    getRepositoryTechnologies,
    refreshRepositoryLanguages,
} from '../../application/repositoryTechnologies.js';
import { getRepositoryVulnerabilities, summarizeFleetRisk } from '../../application/repositoryRisk.js';
import { getDependenciesByRepo } from '../../infrastructure/cache/repositoryStore.js';
import logger from '../../infrastructure/logger.js';

function resolveRepo(idOrUrl) {
    return /^\d+$/.test(idOrUrl) ? getRepo(parseInt(idOrUrl, 10)) : getRepoByUrl(idOrUrl);
}

export function createRepositoryRoutes() {
    const router = express.Router();

    // GET /repositories
    router.get('/', (req, res) => {
        const repositories = listRepos({ includeDeleted: req.query.includeDeleted === 'true' });

        // Exposure comes along for the ride: the list is where an operator
        // notices something is wrong, and asking per repository would be one
        // request per row.
        const risk = summarizeFleetRisk();

        res.json({
            count: repositories.length,
            atRisk: [...risk.keys()].length,
            repositories: repositories.map(repository => ({
                ...repository,
                risk: risk.get(repository.id) ?? { total: 0, bySeverity: {}, exploited: false, worst: null },
            })),
        });
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

    // PATCH /repositories/:idOrUrl — enable/disable, rename, change branch
    router.patch('/:idOrUrl', (req, res) => {
        const repository = resolveRepo(req.params.idOrUrl);
        if (!repository) return res.status(404).json({ error: 'Repository not found' });

        const { enabled } = req.body ?? {};
        if (typeof enabled !== 'boolean') {
            return res.status(400).json({ error: 'enabled must be a boolean' });
        }

        res.json(setRepoEnabled(repository.id, enabled));
    });

    // POST /repositories/:idOrUrl/restore — undo a soft delete
    router.post('/:idOrUrl/restore', (req, res) => {
        const { idOrUrl } = req.params;
        const restored = restoreRepo(/^\d+$/.test(idOrUrl) ? parseInt(idOrUrl, 10) : idOrUrl);
        if (!restored) return res.status(404).json({ error: 'Repository not found' });
        res.json(restored);
    });

    // GET /repositories/:idOrUrl/vulnerabilities — what reaches this repository,
    // and through which dependency
    router.get('/:idOrUrl/vulnerabilities', (req, res) => {
        const repository = resolveRepo(req.params.idOrUrl);
        if (!repository) return res.status(404).json({ error: 'Repository not found' });

        res.json(
            getRepositoryVulnerabilities(repository.id, {
                includeResolved: req.query.includeResolved === 'true',
            })
        );
    });

    // GET /repositories/:idOrUrl/technologies
    router.get('/:idOrUrl/technologies', (req, res) => {
        const repository = resolveRepo(req.params.idOrUrl);
        if (!repository) return res.status(404).json({ error: 'Repository not found' });
        res.json(getRepositoryTechnologies(repository.id));
    });

    // POST /repositories/:idOrUrl/technologies — re-read languages from the provider
    router.post('/:idOrUrl/technologies', async (req, res) => {
        const repository = resolveRepo(req.params.idOrUrl);
        if (!repository) return res.status(404).json({ error: 'Repository not found' });

        try {
            res.json(await refreshRepositoryLanguages(repository.id));
        } catch (error) {
            logger.error({ repo: repository.name, err: error }, 'Language refresh failed');
            res.status(500).json({ error: error.message });
        }
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
            const result = await scanRepository(repository.id, providerForOrg(repository.org_key), {
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
