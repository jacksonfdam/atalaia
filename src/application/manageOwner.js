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
 * @param {{ name: string, email: string, slackUserId?: string }} data
 * @returns {object}
 */
export function addOwner(data) {
    if (!data.name || !data.email) {
        throw new Error('Name and email are required');
    }
    const owner = storeAdd(data);
    logger.info({ email: data.email }, 'System owner added');
    return owner;
}

/**
 * Soft-delete a system owner by ID.
 * @param {number} id
 * @returns {boolean}
 */
export function removeOwner(id) {
    const owner = storeGet(id);
    if (!owner) return false;
    storeSoftDelete(id);
    return true;
}

/**
 * List all owners.
 * @param {{ includeDeleted?: boolean }} [options]
 * @returns {object[]}
 */
export function listOwners(options = {}) {
    return storeList(options);
}

/**
 * Get a single owner with their assignments.
 * @param {number} id
 * @returns {{ owner: object, assignments: object[] } | null}
 */
export function getOwnerWithAssignments(id) {
    const owner = storeGet(id);
    if (!owner) return null;
    const assignments = storeGetAssignments(id);
    return { owner, assignments };
}

/**
 * Update an owner.
 * @param {number} id
 * @param {{ name?: string, email?: string, slackUserId?: string }} updates
 */
export function updateOwner(id, updates) {
    storeUpdate(id, updates);
}

/**
 * Assign an owner to a target (ecosystem, dependency, or repository).
 * @param {number} ownerId
 * @param {string} targetType - 'ecosystem' | 'dependency' | 'repository'
 * @param {string} targetValue - e.g. 'npm', 'express', 'https://github.com/org/repo'
 * @returns {object}
 */
export function assignOwner(ownerId, targetType, targetValue) {
    if (!isValidTargetType(targetType)) {
        throw new Error(`Invalid target type: ${targetType}. Must be: ecosystem, dependency, or repository`);
    }

    const owner = storeGet(ownerId);
    if (!owner) throw new Error(`Owner ${ownerId} not found`);

    const assignment = storeAddAssignment({ ownerId, targetType, targetValue });
    logger.info({ ownerId, targetType, targetValue }, 'Owner assigned');
    return assignment;
}

/**
 * Remove an assignment (soft-delete).
 * @param {number} assignmentId
 * @returns {boolean}
 */
export function unassignOwner(assignmentId) {
    storeSoftDeleteAssignment(assignmentId);
    return true;
}
