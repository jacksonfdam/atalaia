import express from 'express';
import { addOrg, getOrg, listOrgs, removeOrg, updateOrg } from '../../application/manageOrganization.js';
import { importAllOrganizations, importOrgRepositories } from '../../application/importRepositories.js';
import logger from '../../infrastructure/logger.js';

/**
 * Source-code organizations.
 *
 * Tokens are accepted here and never handed back: responses carry `hasToken`
 * and the last four characters, nothing more.
 */
export function createOrganizationRoutes() {
    const router = express.Router();

    // GET /organizations
    router.get('/', (req, res) => {
        const organizations = listOrgs({ includeDeleted: req.query.includeDeleted === 'true' });
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
    router.post('/', (req, res) => {
        const { key, login, name, token } = req.body ?? {};

        try {
            res.status(201).json(addOrg({ key, login, name, token }));
        } catch (error) {
            logger.warn({ login, err: error.message }, 'Failed to add organization');
            res.status(400).json({ error: error.message });
        }
    });

    // GET /organizations/:key
    router.get('/:key', (req, res) => {
        const organization = getOrg(req.params.key);
        if (!organization) return res.status(404).json({ error: 'Organization not found' });
        res.json(organization);
    });

    // PATCH /organizations/:key — rename, enable/disable, replace or clear the token
    router.patch('/:key', (req, res) => {
        const { login, name, enabled, token } = req.body ?? {};
        const updates = {};

        if (login !== undefined) updates.login = login;
        if (name !== undefined) updates.name = name;
        if (enabled !== undefined) updates.enabled = enabled === true;
        // An empty string is an explicit "forget the token"; undefined leaves it.
        if (token !== undefined) updates.token = token || null;

        try {
            res.json(updateOrg(req.params.key, updates));
        } catch (error) {
            res.status(error.message.includes('not found') ? 404 : 400).json({ error: error.message });
        }
    });

    // DELETE /organizations/:key — soft delete, together with its repositories
    router.delete('/:key', (req, res) => {
        const removed = removeOrg(req.params.key);
        if (!removed) return res.status(404).json({ error: 'Organization not found' });
        res.json({ deleted: true, ...removed });
    });

    // POST /organizations/:key/import — read-only listing of the org's repositories
    router.post('/:key/import', async (req, res) => {
        try {
            const result = await importOrgRepositories(req.params.key, {
                withLanguages: req.body?.withLanguages !== false,
            });
            res.json(result);
        } catch (error) {
            const status = error.response?.status;
            logger.error({ org: req.params.key, err: error.message }, 'Repository import failed');

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

            res.status(500).json({ error: error.message });
        }
    });

    return router;
}
