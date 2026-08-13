-- Runtime-tunable settings.
--
-- config.json holds ${ENV_VAR} placeholders that are substituted at load time,
-- so writing resolved configuration back to that file would replace secrets
-- like ${SLACK_WEBHOOK_URL} with their literal values in a tracked file.
-- Overrides therefore live here instead, and resolution order is:
--   environment variable  >  this table  >  config.json
--
-- Values are stored JSON-encoded so booleans, numbers and strings all survive
-- a round trip.
CREATE TABLE IF NOT EXISTS settings (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL,
    updated_at  TEXT DEFAULT (datetime('now')),
    updated_by  TEXT
);
