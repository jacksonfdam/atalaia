import logger from '../infrastructure/logger.js';
import { isValidTargetType } from '../domain/entities/OwnerAssignment.js';
import {
    addOwner as storeAdd,
    softDeleteOwner as storeSoftDelete,
    getOwner as storeGet,
    getOwnerByEmail as storeGetByEmail,
    listOwners as storeList,
    updateOwner as storeUpdate,
    addAssignment as storeAddAssignment,
    softDeleteAssignment as storeSoftDeleteAssignment,
    getAssignmentsByOwner as storeGetAssignments,
} from '../infrastructure/cache/repositoryStore.js';

/**
 * Add a system owner.
 * @param {{ name: string, email: string, slackUserId?: string, telegramChatId?: string }} data
 * @returns {object}
 */
export async function addOwner(data) {
    if (!data.name || !data.email) {
        throw new Error('Name and email are required');
    }
    const owner = await storeAdd(data);
    logger.info({ email: data.email }, 'System owner added');
    return owner;
}

/**
 * Soft-delete a system owner by ID.
 * @param {number} id
 * @returns {boolean}
 */
export async function removeOwner(id) {
    const owner = await storeGet(id);
    if (!owner) return false;
    await storeSoftDelete(id);
    return true;
}

/**
 * List all owners.
 * @param {{ includeDeleted?: boolean }} [options]
 * @returns {object[]}
 */
export async function listOwners(options = {}) {
    return await storeList(options);
}

/**
 * Get a single owner with their assignments.
 * @param {number} id
 * @returns {{ owner: object, assignments: object[] } | null}
 */
export async function getOwnerWithAssignments(id) {
    const owner = await storeGet(id);
    if (!owner) return null;
    const assignments = await storeGetAssignments(id);
    return { owner, assignments };
}

/**
 * Update an owner.
 * @param {number} id
 * @param {{ name?: string, email?: string, slackUserId?: string, telegramChatId?: string }} updates
 */
export async function updateOwner(id, updates) {
    await storeUpdate(id, updates);
}

/**
 * Assign an owner to a target (ecosystem, dependency, or repository).
 * @param {number} ownerId
 * @param {string} targetType - 'ecosystem' | 'dependency' | 'repository'
 * @param {string} targetValue - e.g. 'npm', 'express', 'https://github.com/org/repo'
 * @returns {object}
 */
export async function assignOwner(ownerId, targetType, targetValue) {
    if (!isValidTargetType(targetType)) {
        throw new Error(`Invalid target type: ${targetType}. Must be: ecosystem, dependency, or repository`);
    }

    const owner = await storeGet(ownerId);
    if (!owner) throw new Error(`Owner ${ownerId} not found`);

    const assignment = await storeAddAssignment({ ownerId, targetType, targetValue });
    logger.info({ ownerId, targetType, targetValue }, 'Owner assigned');
    return assignment;
}

/**
 * Remove an assignment (soft-delete).
 * @param {number} assignmentId
 * @returns {boolean}
 */
export async function unassignOwner(assignmentId) {
    await storeSoftDeleteAssignment(assignmentId);
    return true;
}
