import express from 'express';
import {
    addRepo,
    removeRepo,
    getRepo,
    getRepoByUrl,
    restoreRepo,
    setRepoEnabled,
} from '../../application/manageRepository.js';
import {
    getRepositoryTechnologies,
    refreshRepositoryLanguages,
} from '../../application/repositoryTechnologies.js';
import { getRepositoryVulnerabilities } from '../../application/repositoryRisk.js';
import { listRepositoriesPage } from '../../application/listRepositories.js';
import { enqueue, queueState, cancelQueued } from '../../infrastructure/queue/boss.js';
import { QUEUES } from '../../infrastructure/queue/jobs.js';
import { compareVersions } from '../../application/versionComparison.js';
import { getDependenciesByRepo } from '../../infrastructure/cache/repositoryStore.js';
import logger from '../../infrastructure/logger.js';

async function resolveRepo(idOrUrl) {
    return /^\d+$/.test(idOrUrl) ? await getRepo(parseInt(idOrUrl, 10)) : await getRepoByUrl(idOrUrl);
}

export function createRepositoryRoutes() {
    const router = express.Router();

    // GET /repositories — filtered, sorted and paginated.
    //
    // Exposure comes along for the ride: the list is where an operator notices
    // something is wrong, and asking per repository would be one request per row.
    router.get('/', async (req, res) => {
        res.json(await listRepositoriesPage(req.query));
    });

    // GET /repositories/scan-all — progress of the running scan, or the last one.
    // Declared before /:idOrUrl so "scan-all" is not parsed as an identifier.
    router.get('/scan-all', async (_req, res) => {
        const state = await queueState(QUEUES.REPO_SCAN_ALL);

        // The counts live in the job's return value; the console has always been
        // promised them on lastRun, and a missing field there is a blank page.
        if (state.lastRun) {
            const output = state.lastRun.output ?? {};
            state.lastRun = {
                ...state.lastRun,
                repositories: output.totalRepos ?? 0,
                dependencies: output.totalDeps ?? 0,
                errors: output.errors ?? [],
            };
            delete state.lastRun.output;
        }

        res.json(state);
    });

    // DELETE /repositories/scan-all — stop the sweep.
    //
    // Also the way out of "one is already running" when nothing is: a worker
    // killed mid-sweep leaves its job active until the expiry window passes, and
    // an exclusive queue refuses new work until then.
    router.delete('/scan-all', async (_req, res) => {
        const { cancelled } = await cancelQueued(QUEUES.REPO_SCAN_ALL);
        logger.info({ cancelled }, 'Fleet scan cancelled via API');
        res.json({ cancelled });
    });

    // POST /repositories/scan-all — starts it and returns immediately.
    //
    // Scanning a hundred repositories takes far longer than any HTTP client
    // waits, so the work is detached and the caller polls the GET above.
    router.post('/scan-all', async (req, res) => {
        const { accepted, jobId } = await enqueue(QUEUES.REPO_SCAN_ALL, {
            skipVendorLookup: req.body?.skipVendorLookup === true,
            // Per-run override; otherwise SCAN_CONCURRENCY, otherwise ten.
            concurrency: req.body?.concurrency,
        });

        if (!accepted) {
            return res.status(409).json({
                error: 'A repository scan is already running',
                ...(await queueState(QUEUES.REPO_SCAN_ALL)),
            });
        }

        logger.info({ jobId }, 'Fleet scan queued via API');
        res.status(202).json({ accepted: true, jobId });
    });

    // POST /repositories
    router.post('/', async (req, res) => {
        const { url, name, provider, orgKey, defaultBranch } = req.body ?? {};

        if (!url || typeof url !== 'string') {
            return res.status(400).json({ error: 'url is required' });
        }

        try {
            const repository = await addRepo(url, { name, provider, orgKey, defaultBranch });
            res.status(201).json(repository);
        } catch (error) {
            logger.warn({ url, err: error }, 'Failed to add repository');
            res.status(400).json({ error: error.message });
        }
    });

    // GET /repositories/:idOrUrl
    router.get('/:idOrUrl', async (req, res) => {
        const repository = await resolveRepo(req.params.idOrUrl);
        if (!repository) return res.status(404).json({ error: 'Repository not found' });
        res.json(repository);
    });

    // PATCH /repositories/:idOrUrl — enable/disable, rename, change branch
    router.patch('/:idOrUrl', async (req, res) => {
        const repository = await resolveRepo(req.params.idOrUrl);
        if (!repository) return res.status(404).json({ error: 'Repository not found' });

        const { enabled } = req.body ?? {};
        if (typeof enabled !== 'boolean') {
            return res.status(400).json({ error: 'enabled must be a boolean' });
        }

        res.json(await setRepoEnabled(repository.id, enabled));
    });

    // POST /repositories/:idOrUrl/restore — undo a soft delete
    router.post('/:idOrUrl/restore', async (req, res) => {
        const { idOrUrl } = req.params;
        const restored = await restoreRepo(/^\d+$/.test(idOrUrl) ? parseInt(idOrUrl, 10) : idOrUrl);
        if (!restored) return res.status(404).json({ error: 'Repository not found' });
        res.json(restored);
    });

    // GET /repositories/:idOrUrl/vulnerabilities — what reaches this repository,
    // and through which dependency
    router.get('/:idOrUrl/vulnerabilities', async (req, res) => {
        const repository = await resolveRepo(req.params.idOrUrl);
        if (!repository) return res.status(404).json({ error: 'Repository not found' });

        res.json(
            await getRepositoryVulnerabilities(repository.id, {
                includeResolved: req.query.includeResolved === 'true',
            })
        );
    });

    // GET /repositories/:idOrUrl/technologies
    router.get('/:idOrUrl/technologies', async (req, res) => {
        const repository = await resolveRepo(req.params.idOrUrl);
        if (!repository) return res.status(404).json({ error: 'Repository not found' });
        res.json(await getRepositoryTechnologies(repository.id));
    });

    // POST /repositories/:idOrUrl/technologies — re-read languages from the provider
    router.post('/:idOrUrl/technologies', async (req, res) => {
        const repository = await resolveRepo(req.params.idOrUrl);
        if (!repository) return res.status(404).json({ error: 'Repository not found' });

        try {
            res.json(await refreshRepositoryLanguages(repository.id));
        } catch (error) {
            logger.error({ repo: repository.name, err: error }, 'Language refresh failed');
            res.status(500).json({ error: error.message });
        }
    });

    // DELETE /repositories/:idOrUrl — soft delete
    router.delete('/:idOrUrl', async (req, res) => {
        const { idOrUrl } = req.params;
        const removed = await removeRepo(/^\d+$/.test(idOrUrl) ? parseInt(idOrUrl, 10) : idOrUrl);
        if (!removed) return res.status(404).json({ error: 'Repository not found' });
        res.json({ deleted: true, repository: idOrUrl });
    });

    // GET /repositories/:idOrUrl/dependencies — every dependency, with whatever
    // freshness has already been resolved
    router.get('/:idOrUrl/dependencies', async (req, res) => {
        const repository = await resolveRepo(req.params.idOrUrl);
        if (!repository) return res.status(404).json({ error: 'Repository not found' });

        let dependencies = await getDependenciesByRepo(repository.id);
        if (req.query.ecosystem) {
            const wanted = String(req.query.ecosystem).toUpperCase();
            dependencies = dependencies.filter(d => String(d.ecosystem).toUpperCase() === wanted);
        }

        const enriched = dependencies.map(dependency => {
            // Computed here rather than stored: it compares two columns, and a
            // third column would be one more thing to keep in sync.
            const comparison = compareVersions(
                dependency.ecosystem,
                dependency.version,
                dependency.latest_version
            );

            return {
                ...dependency,
                versionState: comparison.state,
                versionGap: comparison.gap,
                versionNote: comparison.reason,
                outdated: comparison.state === 'behind',
            };
        });

        // Grouped by ecosystem: a repository can carry Gradle, GitHub Actions,
        // Fastlane gems and npm at once, and they are read one type at a time.
        const groups = new Map();
        for (const dependency of enriched) {
            const group = groups.get(dependency.ecosystem) ?? {
                ecosystem: dependency.ecosystem,
                count: 0,
                outdated: 0,
                unchecked: 0,
            };

            group.count += 1;
            if (dependency.outdated) group.outdated += 1;
            if (!dependency.latest_checked_at) group.unchecked += 1;
            groups.set(dependency.ecosystem, group);
        }

        res.json({
            count: enriched.length,
            outdated: enriched.filter(dependency => dependency.outdated).length,
            unchecked: enriched.filter(dependency => !dependency.latest_checked_at).length,
            groups: [...groups.values()].sort((a, b) => b.count - a.count),
            repository,
            dependencies: enriched,
            versionCheck: await queueState(QUEUES.DEPS_VERSIONS, `repo:${repository.id}`),
        });
    });

    // GET /repositories/:idOrUrl/versions — progress of the freshness check
    router.get('/:idOrUrl/versions', async (req, res) => {
        const repository = await resolveRepo(req.params.idOrUrl);
        if (!repository) return res.status(404).json({ error: 'Repository not found' });

        res.json(await queueState(QUEUES.DEPS_VERSIONS, `repo:${repository.id}`));
    });

    // POST /repositories/:idOrUrl/versions — look up the latest published
    // version of each dependency, in the background
    router.post('/:idOrUrl/versions', async (req, res) => {
        const repository = await resolveRepo(req.params.idOrUrl);
        if (!repository) return res.status(404).json({ error: 'Repository not found' });

        // singletonKey scopes the queue's exclusivity to this repository: two
        // repositories may be checked at once, the same one may not.
        const singletonKey = `repo:${repository.id}`;

        const { accepted, jobId } = await enqueue(
            QUEUES.DEPS_VERSIONS,
            {
                repositoryId: repository.id,
                force: req.body?.force === true,
                maxAgeHours: req.body?.maxAgeHours,
            },
            { singletonKey }
        );

        if (!accepted) {
            return res.status(409).json({
                error: 'A version check is already running',
                ...(await queueState(QUEUES.DEPS_VERSIONS, singletonKey)),
            });
        }

        res.status(202).json({ accepted: true, jobId });
    });

    // POST /repositories/:idOrUrl/scan
    router.post('/:idOrUrl/scan', async (req, res) => {
        const repository = await resolveRepo(req.params.idOrUrl);
        if (!repository) return res.status(404).json({ error: 'Repository not found' });

        // Queued rather than run here: a scan reads every manifest in the
        // repository over the network, which outlives the console's proxy
        // timeout on anything but a small project.
        const { accepted, jobId } = await enqueue(QUEUES.REPO_SCAN, {
            repositoryId: repository.id,
            skipVendorLookup: req.body?.skipVendorLookup === true,
        });

        if (!accepted) {
            return res.status(409).json({ error: 'A scan is already queued for this repository' });
        }

        logger.info({ jobId, repo: repository.name }, 'Repository scan queued');
        res.status(202).json({ accepted: true, jobId });
    });

    return router;
}
