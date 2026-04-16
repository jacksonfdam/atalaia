/**
 * Maps a SystemOwner to a target they are responsible for.
 * targetType: 'ecosystem' | 'dependency' | 'repository'
 * targetValue: e.g. "npm", "express", "https://github.com/org/repo"
 */
class OwnerAssignment {
    constructor({
        id = null,
        ownerId,
        targetType,
        targetValue,
        createdAt = null,
        deletedAt = null,
    }) {
        this.id = id;
        this.ownerId = ownerId;
        this.targetType = targetType;
        this.targetValue = targetValue;
        this.createdAt = createdAt;
        this.deletedAt = deletedAt;
    }

    isDeleted() {
        return this.deletedAt !== null;
    }
}

export const ASSIGNMENT_TARGET_TYPES = Object.freeze(['ecosystem', 'dependency', 'repository']);

export function isValidTargetType(type) {
    return ASSIGNMENT_TARGET_TYPES.includes(type);
}

export default OwnerAssignment;
