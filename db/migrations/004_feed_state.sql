-- Per-source on/off switch.
--
-- The registry in src/infrastructure/feeds/feedRegistry.js ships a sensible
-- default for every source; this table only records the rows an operator has
-- changed, so a default can be revised in code without silently overriding a
-- deliberate choice made in the console.
CREATE TABLE IF NOT EXISTS feed_state (
    name        TEXT PRIMARY KEY,
    enabled     INTEGER NOT NULL,
    updated_at  TEXT DEFAULT (datetime('now')),
    updated_by  TEXT
);
