-- The code we ship, its dependencies, and who answers for them.
--
-- Deletes are soft everywhere in here: an import must not resurrect what an
-- operator removed, so removal is a timestamp rather than a missing row.

CREATE TABLE IF NOT EXISTS repositories (
    id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name              text NOT NULL,
    url               text UNIQUE NOT NULL,
    provider          text NOT NULL CHECK (provider IN ('github', 'gitlab', 'bitbucket')),
    org_key           text,
    default_branch    text DEFAULT 'main',
    last_scanned_at   timestamptz,
    enabled           boolean NOT NULL DEFAULT true,
    -- Reported by the provider, as opposed to inferred from the manifests: a
    -- repository can report "TypeScript" and carry its risk in a Dockerfile.
    primary_language  text,
    languages         jsonb,
    topics            jsonb,
    description       text,
    archived          boolean NOT NULL DEFAULT false,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),
    deleted_at        timestamptz
);

CREATE INDEX IF NOT EXISTS idx_repos_provider ON repositories (provider);
CREATE INDEX IF NOT EXISTS idx_repos_org_key ON repositories (org_key);
CREATE INDEX IF NOT EXISTS idx_repos_deleted ON repositories (deleted_at);

CREATE TABLE IF NOT EXISTS repository_dependencies (
    id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    repository_id      bigint NOT NULL REFERENCES repositories (id) ON DELETE CASCADE,
    ecosystem          text NOT NULL,
    name               text NOT NULL,
    version            text,
    manifest_file      text,
    opencve_vendor     text,
    opencve_product    text,
    -- Freshness, cached per row: a repository has hundreds of dependencies,
    -- each lookup is a request to somebody else's registry, and the answer
    -- changes on the order of days. Each row is written the moment its own
    -- lookup returns, so a check that dies halfway keeps what it resolved.
    latest_version     text,
    latest_checked_at  timestamptz,
    latest_error       text,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    deleted_at         timestamptz,
    UNIQUE (repository_id, ecosystem, name, manifest_file)
);

CREATE INDEX IF NOT EXISTS idx_deps_repo ON repository_dependencies (repository_id);
CREATE INDEX IF NOT EXISTS idx_deps_vendor_product ON repository_dependencies (opencve_vendor, opencve_product);
CREATE INDEX IF NOT EXISTS idx_deps_deleted ON repository_dependencies (deleted_at);
CREATE INDEX IF NOT EXISTS idx_deps_ecosystem ON repository_dependencies (ecosystem);
CREATE INDEX IF NOT EXISTS idx_deps_name_lower ON repository_dependencies (lower(name));

CREATE TABLE IF NOT EXISTS system_owners (
    id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name           text NOT NULL,
    email          text UNIQUE NOT NULL,
    slack_user_id  text,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    deleted_at     timestamptz
);

CREATE INDEX IF NOT EXISTS idx_owners_deleted ON system_owners (deleted_at);

CREATE TABLE IF NOT EXISTS owner_assignments (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    owner_id      bigint NOT NULL REFERENCES system_owners (id) ON DELETE CASCADE,
    target_type   text NOT NULL CHECK (target_type IN ('ecosystem', 'dependency', 'repository')),
    target_value  text NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),
    deleted_at    timestamptz,
    UNIQUE (owner_id, target_type, target_value)
);

CREATE INDEX IF NOT EXISTS idx_assignments_owner ON owner_assignments (owner_id);
CREATE INDEX IF NOT EXISTS idx_assignments_target ON owner_assignments (target_type, target_value);
CREATE INDEX IF NOT EXISTS idx_assignments_deleted ON owner_assignments (deleted_at);

CREATE TABLE IF NOT EXISTS vendor_product_mappings (
    id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ecosystem        text NOT NULL,
    package_name     text NOT NULL,
    opencve_vendor   text NOT NULL,
    opencve_product  text NOT NULL,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    UNIQUE (ecosystem, package_name)
);
