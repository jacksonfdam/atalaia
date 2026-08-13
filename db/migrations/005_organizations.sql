-- Source-code organizations and the repository metadata imported from them.
--
-- Each organization carries its own access token: several GitHub orgs, several
-- tokens, no shared credential. The token is stored encrypted (see
-- src/infrastructure/crypto.js) and is never returned by the API.
--
-- config.json's `providers` array remains supported for deployments that pin
-- credentials in the environment; rows here are the ones an operator manages
-- from the console.
CREATE TABLE IF NOT EXISTS organizations (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    key             TEXT UNIQUE NOT NULL,
    login           TEXT NOT NULL,
    name            TEXT,
    provider        TEXT NOT NULL DEFAULT 'github' CHECK(provider IN ('github')),
    token_cipher    TEXT,
    token_hint      TEXT,
    enabled         INTEGER NOT NULL DEFAULT 1,
    last_import_at  TEXT,
    created_at      TEXT DEFAULT (datetime('now')),
    updated_at      TEXT DEFAULT (datetime('now')),
    deleted_at      TEXT
);

CREATE INDEX IF NOT EXISTS idx_orgs_deleted ON organizations(deleted_at);

-- Technologies observed on the repository itself, as opposed to the ones
-- inferred from its manifests. Filled by the importer, which reads them from
-- the provider.
ALTER TABLE repositories ADD COLUMN primary_language TEXT;
ALTER TABLE repositories ADD COLUMN languages TEXT;
ALTER TABLE repositories ADD COLUMN topics TEXT;
ALTER TABLE repositories ADD COLUMN description TEXT;
ALTER TABLE repositories ADD COLUMN archived INTEGER DEFAULT 0;
