import express from 'express';
import { addOrg, getOrg, listOrgs, removeOrg, updateOrg } from '../../application/manageOrganization.js';
import {
    importAllOrganizations,
    importOrgRepositories,
    previewOrgRepositories,
} from '../../application/importRepositories.js';
import logger from '../../infrastructure/logger.js';

/** GitHub failures are the operator's problem to fix, not a 500. */
function githubError(res, error, key) {
    const status = error.response?.status;
    logger.error({ org: key, err: error.message, status }, 'GitHub request failed');

    if (status === 401 || status === 403) {
        return res.status(400).json({
            error: 'GitHub rejected the token for this organization',
            detail: error.message,
        });
    }
    if (status === 404) {
        return res.status(400).json({
            error: 'GitHub has no organization or user with that login, or the token cannot see it',
        });
    }
    return res.status(500).json({ error: error.message });
}

/**
 * Source-code organizations.
 *
 * Tokens are accepted here and never handed back: responses carry `hasToken`
 * and the last four characters, nothing more.
 */
export function createOrganizationRoutes() {
    const router = express.Router();

    // GET /organizations
    router.get('/', async (req, res) => {
        const organizations = await listOrgs({ includeDeleted: req.query.includeDeleted === 'true' });
        res.json({ count: organizations.length, organizations });
    });

    // POST /organizations/import — every enabled organization, declared before
    // /:key so "import" is not read as a key
    router.post('/import', async (req, res) => {
        try {
            const result = await importAllOrganizations({
                withLanguages: req.body?.withLanguages !== false,
            });
            res.json(result);
        } catch (error) {
            logger.error({ err: error }, 'Import of all organizations failed');
            res.status(500).json({ error: error.message });
        }
    });

    // POST /organizations
    router.post('/', async (req, res) => {
        const { key, login, name, token } = req.body ?? {};

        try {
            res.status(201).json(await addOrg({ key, login, name, token }));
        } catch (error) {
            logger.warn({ login, err: error.message }, 'Failed to add organization');
            res.status(400).json({ error: error.message });
        }
    });

    // GET /organizations/:key
    router.get('/:key', async (req, res) => {
        const organization = await getOrg(req.params.key);
        if (!organization) return res.status(404).json({ error: 'Organization not found' });
        res.json(organization);
    });

    // PATCH /organizations/:key — rename, enable/disable, replace or clear the token
    router.patch('/:key', async (req, res) => {
        const { login, name, enabled, token } = req.body ?? {};
        const updates = {};

        if (login !== undefined) updates.login = login;
        if (name !== undefined) updates.name = name;
        if (enabled !== undefined) updates.enabled = enabled === true;
        // An empty string is an explicit "forget the token"; undefined leaves it.
        if (token !== undefined) updates.token = token || null;

        try {
            res.json(await updateOrg(req.params.key, updates));
        } catch (error) {
            res.status(error.message.includes('not found') ? 404 : 400).json({ error: error.message });
        }
    });

    // DELETE /organizations/:key — soft delete, together with its repositories
    router.delete('/:key', async (req, res) => {
        const removed = await removeOrg(req.params.key);
        if (!removed) return res.status(404).json({ error: 'Organization not found' });
        res.json({ deleted: true, ...removed });
    });

    // GET /organizations/:key/repositories — what the token can see, annotated
    // with what Atalaia already tracks. Nothing is stored; this is the list an
    // operator picks from.
    router.get('/:key/repositories', async (req, res) => {
        try {
            res.json(await previewOrgRepositories(req.params.key));
        } catch (error) {
            if (error.message.includes('not found') || error.message.includes('deleted')) {
                return res.status(404).json({ error: error.message });
            }
            githubError(res, error, req.params.key);
        }
    });

    // POST /organizations/:key/import — read-only listing of the org's
    // repositories. Without `repositories`, the whole organization.
    router.post('/:key/import', async (req, res) => {
        const only = req.body?.repositories;

        if (only !== undefined && (!Array.isArray(only) || only.some(entry => typeof entry !== 'string'))) {
            return res.status(400).json({ error: 'repositories must be an array of names or URLs' });
        }

        try {
            const result = await importOrgRepositories(req.params.key, {
                withLanguages: req.body?.withLanguages !== false,
                only,
            });
            res.json(result);
        } catch (error) {
            githubError(res, error, req.params.key);
        }
    });

    return router;
}
