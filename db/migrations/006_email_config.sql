-- Email delivery settings managed from the console.
--
-- One row, always id 1: there is a single sender configuration, and a table
-- with a single row keeps the update a plain UPSERT instead of a key/value
-- shuffle across seven rows of the settings table.
--
-- The password/API key is stored encrypted (see src/infrastructure/crypto.js)
-- and never returned by the API — only a four-character hint is.
--
-- SMTP_HOST and friends still win when set: a deployment that pins credentials
-- in the environment keeps working untouched.
CREATE TABLE IF NOT EXISTS email_config (
    id            INTEGER PRIMARY KEY CHECK (id = 1),
    provider      TEXT NOT NULL DEFAULT 'smtp',
    host          TEXT,
    port          INTEGER,
    username      TEXT,
    secret_cipher TEXT,
    secret_hint   TEXT,
    from_address  TEXT,
    recipients    TEXT,
    template      TEXT NOT NULL DEFAULT 'professional',
    enabled       INTEGER NOT NULL DEFAULT 0,
    updated_at    TEXT DEFAULT (datetime('now')),
    updated_by    TEXT
);
