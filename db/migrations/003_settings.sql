-- Runtime-tunable settings, and the per-source on/off switch.
--
-- config.json holds ${ENV_VAR} placeholders substituted at load time, so
-- writing resolved configuration back to that file would replace secrets with
-- their literal values in a tracked file. Overrides live here instead, and
-- resolution order is:
--   environment variable  >  this table  >  config.json
--
-- Values are JSON-encoded so booleans, numbers and strings survive a round trip.
CREATE TABLE IF NOT EXISTS settings (
    key         text PRIMARY KEY,
    value       text NOT NULL,
    updated_at  timestamptz NOT NULL DEFAULT now(),
    updated_by  text
);

-- The registry in src/infrastructure/feeds/feedRegistry.js ships a default for
-- every source; this table records only the rows an operator has changed, so a
-- default can be revised in code without overriding a deliberate choice.
CREATE TABLE IF NOT EXISTS feed_state (
    name        text PRIMARY KEY,
    enabled     boolean NOT NULL,
    updated_at  timestamptz NOT NULL DEFAULT now(),
    updated_by  text
);
