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
    router.get('/', (req, res) => {
        const owners = listOwners({ includeDeleted: req.query.includeDeleted === 'true' });
        res.json({ count: owners.length, owners });
    });

    // POST /owners
    router.post('/', (req, res) => {
        const { name, email, slackUserId } = req.body ?? {};
        try {
            const owner = addOwner({ name, email, slackUserId: slackUserId ?? null });
            res.status(201).json(owner);
        } catch (error) {
            logger.warn({ err: error }, 'Failed to add owner');
            res.status(400).json({ error: error.message });
        }
    });

    // GET /owners/:id — includes assignments
    router.get('/:id', (req, res) => {
        const result = getOwnerWithAssignments(parseInt(req.params.id, 10));
        if (!result) return res.status(404).json({ error: 'Owner not found' });
        res.json(result);
    });

    // PATCH /owners/:id
    router.patch('/:id', (req, res) => {
        const id = parseInt(req.params.id, 10);
        if (!getOwnerWithAssignments(id)) return res.status(404).json({ error: 'Owner not found' });

        const { name, email, slackUserId } = req.body ?? {};
        try {
            updateOwner(id, { name, email, slackUserId });
            res.json(getOwnerWithAssignments(id));
        } catch (error) {
            res.status(400).json({ error: error.message });
        }
    });

    // DELETE /owners/:id — soft delete
    router.delete('/:id', (req, res) => {
        const removed = removeOwner(parseInt(req.params.id, 10));
        if (!removed) return res.status(404).json({ error: 'Owner not found' });
        res.json({ deleted: true, owner: req.params.id });
    });

    // POST /owners/:id/assignments
    router.post('/:id/assignments', (req, res) => {
        const { targetType, targetValue } = req.body ?? {};

        if (!targetType || !targetValue) {
            return res.status(400).json({ error: 'targetType and targetValue are required' });
        }

        try {
            const assignment = assignOwner(parseInt(req.params.id, 10), targetType, targetValue);
            res.status(201).json(assignment);
        } catch (error) {
            const status = error.message.includes('not found') ? 404 : 400;
            res.status(status).json({ error: error.message });
        }
    });

    // DELETE /owners/:id/assignments/:assignmentId
    router.delete('/:id/assignments/:assignmentId', (req, res) => {
        unassignOwner(parseInt(req.params.assignmentId, 10));
        res.json({ deleted: true, assignment: req.params.assignmentId });
    });

    return router;
}
