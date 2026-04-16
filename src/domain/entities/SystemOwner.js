class SystemOwner {
    constructor({
        id = null,
        name,
        email,
        slackUserId = null,
        createdAt = null,
        updatedAt = null,
        deletedAt = null,
    }) {
        this.id = id;
        this.name = name;
        this.email = email;
        this.slackUserId = slackUserId;
        this.createdAt = createdAt;
        this.updatedAt = updatedAt;
        this.deletedAt = deletedAt;
    }

    isDeleted() {
        return this.deletedAt !== null;
    }
}

export default SystemOwner;
