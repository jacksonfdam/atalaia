/**
 * Port interface for repository, dependency, and owner persistence.
 * All queries filter out soft-deleted records by default.
 */
export class RepositoryStorePort {
    // ── Repositories ──

    /**
     * @param {import('../entities/Repository.js').default} repo
     * @returns {object} Inserted row with id
     */
    addRepository(repo) {
        throw new Error('RepositoryStorePort.addRepository() not implemented');
    }

    /**
     * Soft-delete a repository and cascade to its dependencies.
     * @param {number} id
     */
    softDeleteRepository(id) {
        throw new Error('RepositoryStorePort.softDeleteRepository() not implemented');
    }

    /**
     * @param {number} id
     * @returns {object|null}
     */
    getRepository(id) {
        throw new Error('RepositoryStorePort.getRepository() not implemented');
    }

    /**
     * @param {string} url
     * @returns {object|null}
     */
    getRepositoryByUrl(url) {
        throw new Error('RepositoryStorePort.getRepositoryByUrl() not implemented');
    }

    /**
     * @param {{ includeDeleted?: boolean }} [options]
     * @returns {object[]}
     */
    listRepositories(options) {
        throw new Error('RepositoryStorePort.listRepositories() not implemented');
    }

    /**
     * @param {number} id
     * @param {object} updates
     */
    updateRepository(id, updates) {
        throw new Error('RepositoryStorePort.updateRepository() not implemented');
    }

    // ── Dependencies ──

    /**
     * Atomic replace: soft-delete deps not in the new list, upsert current ones.
     * @param {number} repoId
     * @param {import('../entities/Dependency.js').default[]} deps
     */
    replaceDependencies(repoId, deps) {
        throw new Error('RepositoryStorePort.replaceDependencies() not implemented');
    }

    /**
     * @param {number} repoId
     * @param {{ includeDeleted?: boolean }} [options]
     * @returns {object[]}
     */
    getDependenciesByRepo(repoId, options) {
        throw new Error('RepositoryStorePort.getDependenciesByRepo() not implemented');
    }

    /**
     * Find repositories that use a specific vendor/product combination.
     * Only returns non-deleted repos with non-deleted dependencies.
     * @param {string} vendor - OpenCVE vendor
     * @param {string} product - OpenCVE product
     * @returns {object[]} Repositories with matching dependencies
     */
    findAffectedRepositories(vendor, product) {
        throw new Error('RepositoryStorePort.findAffectedRepositories() not implemented');
    }

    // ── System Owners ──

    /**
     * @param {import('../entities/SystemOwner.js').default} owner
     * @returns {object} Inserted row with id
     */
    addOwner(owner) {
        throw new Error('RepositoryStorePort.addOwner() not implemented');
    }

    /**
     * @param {number} id
     */
    softDeleteOwner(id) {
        throw new Error('RepositoryStorePort.softDeleteOwner() not implemented');
    }

    /**
     * @param {{ includeDeleted?: boolean }} [options]
     * @returns {object[]}
     */
    listOwners(options) {
        throw new Error('RepositoryStorePort.listOwners() not implemented');
    }

    /**
     * @param {number} id
     * @returns {object|null}
     */
    getOwner(id) {
        throw new Error('RepositoryStorePort.getOwner() not implemented');
    }

    // ── Owner Assignments ──

    /**
     * @param {import('../entities/OwnerAssignment.js').default} assignment
     * @returns {object}
     */
    addAssignment(assignment) {
        throw new Error('RepositoryStorePort.addAssignment() not implemented');
    }

    /**
     * @param {number} assignmentId
     */
    softDeleteAssignment(assignmentId) {
        throw new Error('RepositoryStorePort.softDeleteAssignment() not implemented');
    }

    /**
     * @param {number} ownerId
     * @returns {object[]}
     */
    getAssignmentsByOwner(ownerId) {
        throw new Error('RepositoryStorePort.getAssignmentsByOwner() not implemented');
    }

    /**
     * Find all owners responsible for a vulnerability based on its vendor/product,
     * ecosystem, and affected repositories.
     * @param {{ vendor?: string, product?: string, ecosystem?: string, repoIds?: number[] }} criteria
     * @returns {object[]} SystemOwner records
     */
    findOwnersForVulnerability(criteria) {
        throw new Error('RepositoryStorePort.findOwnersForVulnerability() not implemented');
    }

    // ── Vendor/Product Mappings ──

    /**
     * @param {string} ecosystem
     * @param {string} packageName
     * @returns {{ vendor: string, product: string } | null}
     */
    getVendorProductMapping(ecosystem, packageName) {
        throw new Error('RepositoryStorePort.getVendorProductMapping() not implemented');
    }

    /**
     * @param {string} ecosystem
     * @param {string} packageName
     * @param {string} vendor
     * @param {string} product
     */
    setVendorProductMapping(ecosystem, packageName, vendor, product) {
        throw new Error('RepositoryStorePort.setVendorProductMapping() not implemented');
    }

    /**
     * Get all unique dependency names and mapped vendor/products from non-deleted deps.
     * Used for dynamic technology filter generation.
     * @returns {{ name: string, ecosystem: string, opencveVendor: string|null, opencveProduct: string|null }[]}
     */
    getAllUniqueDependencies() {
        throw new Error('RepositoryStorePort.getAllUniqueDependencies() not implemented');
    }
}
