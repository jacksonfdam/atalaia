-- Source-code organizations.
--
-- Each one carries its own access token: several GitHub orgs, several tokens,
-- no shared credential. The token is stored encrypted (see
-- src/infrastructure/crypto.js) and is never returned by the API.
--
-- config.json's `providers` array remains supported for deployments that pin
-- credentials in the environment; rows here are what an operator manages from
-- the console.
CREATE TABLE IF NOT EXISTS organizations (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    key             text UNIQUE NOT NULL,
    login           text NOT NULL,
    name            text,
    provider        text NOT NULL DEFAULT 'github' CHECK (provider IN ('github')),
    token_cipher    text,
    token_hint      text,
    enabled         boolean NOT NULL DEFAULT true,
    last_import_at  timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    deleted_at      timestamptz
);

CREATE INDEX IF NOT EXISTS idx_orgs_deleted ON organizations (deleted_at);
