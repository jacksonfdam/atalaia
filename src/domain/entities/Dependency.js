import { isValidEcosystem } from '../enums/Ecosystem.js';

class Dependency {
    constructor({
        id = null,
        repositoryId,
        ecosystem,
        name,
        version = null,
        manifestFile = null,
        opencveVendor = null,
        opencveProduct = null,
        createdAt = null,
        updatedAt = null,
        deletedAt = null,
    }) {
        this.id = id;
        this.repositoryId = repositoryId;
        this.ecosystem = isValidEcosystem(ecosystem) ? ecosystem : 'UNKNOWN';
        this.name = name;
        this.version = version;
        this.manifestFile = manifestFile;
        this.opencveVendor = opencveVendor;
        this.opencveProduct = opencveProduct;
        this.createdAt = createdAt;
        this.updatedAt = updatedAt;
        this.deletedAt = deletedAt;
    }

    isDeleted() {
        return this.deletedAt !== null;
    }

    isMapped() {
        return this.opencveVendor !== null && this.opencveProduct !== null;
    }
}

export default Dependency;
