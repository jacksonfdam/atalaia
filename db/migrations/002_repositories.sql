-- Repository scanning, dependency tracking, system ownership

CREATE TABLE IF NOT EXISTS repositories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    url TEXT UNIQUE NOT NULL,
    provider TEXT NOT NULL CHECK(provider IN ('github', 'gitlab', 'bitbucket')),
    org_key TEXT,
    default_branch TEXT DEFAULT 'main',
    last_scanned_at TEXT,
    enabled INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_repos_url ON repositories(url);
CREATE INDEX IF NOT EXISTS idx_repos_provider ON repositories(provider);
CREATE INDEX IF NOT EXISTS idx_repos_org_key ON repositories(org_key);
CREATE INDEX IF NOT EXISTS idx_repos_deleted ON repositories(deleted_at);

CREATE TABLE IF NOT EXISTS repository_dependencies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    repository_id INTEGER NOT NULL REFERENCES repositories(id),
    ecosystem TEXT NOT NULL,
    name TEXT NOT NULL,
    version TEXT,
    manifest_file TEXT,
    opencve_vendor TEXT,
    opencve_product TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    deleted_at TEXT,
    UNIQUE(repository_id, ecosystem, name, manifest_file)
);

CREATE INDEX IF NOT EXISTS idx_deps_repo ON repository_dependencies(repository_id);
CREATE INDEX IF NOT EXISTS idx_deps_vendor_product ON repository_dependencies(opencve_vendor, opencve_product);
CREATE INDEX IF NOT EXISTS idx_deps_deleted ON repository_dependencies(deleted_at);
CREATE INDEX IF NOT EXISTS idx_deps_ecosystem ON repository_dependencies(ecosystem);

CREATE TABLE IF NOT EXISTS system_owners (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    slack_user_id TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_owners_deleted ON system_owners(deleted_at);

CREATE TABLE IF NOT EXISTS owner_assignments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id INTEGER NOT NULL REFERENCES system_owners(id),
    target_type TEXT NOT NULL CHECK(target_type IN ('ecosystem', 'dependency', 'repository')),
    target_value TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    deleted_at TEXT,
    UNIQUE(owner_id, target_type, target_value)
);

CREATE INDEX IF NOT EXISTS idx_assignments_owner ON owner_assignments(owner_id);
CREATE INDEX IF NOT EXISTS idx_assignments_target ON owner_assignments(target_type, target_value);
CREATE INDEX IF NOT EXISTS idx_assignments_deleted ON owner_assignments(deleted_at);

CREATE TABLE IF NOT EXISTS vendor_product_mappings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ecosystem TEXT NOT NULL,
    package_name TEXT NOT NULL,
    opencve_vendor TEXT NOT NULL,
    opencve_product TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(ecosystem, package_name)
);

CREATE INDEX IF NOT EXISTS idx_vpm_lookup ON vendor_product_mappings(ecosystem, package_name);
