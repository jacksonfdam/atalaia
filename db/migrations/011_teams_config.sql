-- Microsoft Teams delivery.
--
-- One row, always id 1, same shape as slack_config. Teams has no bot mode here:
-- a Workflows (Power Automate) webhook is bound to the channel it was created
-- in, which is the whole of what it offers an outside service.
--
-- The URL is a credential — anyone holding it can post into that channel — so
-- it is encrypted like any other.
CREATE TABLE IF NOT EXISTS teams_config (
    id             INTEGER PRIMARY KEY CHECK (id = 1),
    webhook_cipher TEXT,
    webhook_hint   TEXT,
    enabled        INTEGER NOT NULL DEFAULT 0,
    updated_at     TEXT DEFAULT (datetime('now')),
    updated_by     TEXT
);
