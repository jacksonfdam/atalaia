import express from 'express';
import {
    addOwner,
    removeOwner,
    listOwners,
    getOwnerWithAssignments,
    updateOwner,
    assignOwner,
    unassignOwner,
} from '../../application/manageOwner.js';
import logger from '../../infrastructure/logger.js';

export function createOwnerRoutes() {
    const router = express.Router();

    // GET /owners
    router.get('/', async (req, res) => {
        const owners = await listOwners({ includeDeleted: req.query.includeDeleted === 'true' });
        res.json({ count: owners.length, owners });
    });

    // POST /owners
    router.post('/', async (req, res) => {
        const { name, email, slackUserId, telegramChatId } = req.body ?? {};
        try {
            const owner = await addOwner({
                name,
                email,
                slackUserId: slackUserId ?? null,
                telegramChatId: telegramChatId ?? null,
            });
            res.status(201).json(owner);
        } catch (error) {
            logger.warn({ err: error }, 'Failed to add owner');
            res.status(400).json({ error: error.message });
        }
    });

    // GET /owners/:id — includes assignments
    router.get('/:id', async (req, res) => {
        const result = await getOwnerWithAssignments(parseInt(req.params.id, 10));
        if (!result) return res.status(404).json({ error: 'Owner not found' });
        res.json(result);
    });

    // PATCH /owners/:id
    router.patch('/:id', async (req, res) => {
        const id = parseInt(req.params.id, 10);
        if (!await getOwnerWithAssignments(id)) return res.status(404).json({ error: 'Owner not found' });

        const { name, email, slackUserId, telegramChatId } = req.body ?? {};
        try {
            await updateOwner(id, { name, email, slackUserId, telegramChatId });
            res.json(await getOwnerWithAssignments(id));
        } catch (error) {
            res.status(400).json({ error: error.message });
        }
    });

    // DELETE /owners/:id — soft delete
    router.delete('/:id', async (req, res) => {
        const removed = await removeOwner(parseInt(req.params.id, 10));
        if (!removed) return res.status(404).json({ error: 'Owner not found' });
        res.json({ deleted: true, owner: req.params.id });
    });

    // POST /owners/:id/assignments
    router.post('/:id/assignments', async (req, res) => {
        const { targetType, targetValue } = req.body ?? {};

        if (!targetType || !targetValue) {
            return res.status(400).json({ error: 'targetType and targetValue are required' });
        }

        try {
            const assignment = await assignOwner(parseInt(req.params.id, 10), targetType, targetValue);
            res.status(201).json(assignment);
        } catch (error) {
            const status = error.message.includes('not found') ? 404 : 400;
            res.status(status).json({ error: error.message });
        }
    });

    // DELETE /owners/:id/assignments/:assignmentId
    router.delete('/:id/assignments/:assignmentId', async (req, res) => {
        await unassignOwner(parseInt(req.params.assignmentId, 10));
        res.json({ deleted: true, assignment: req.params.assignmentId });
    });

    return router;
}
