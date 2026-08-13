-- Slack delivery settings managed from the console.
--
-- One row, always id 1, same shape as email_config.
--
-- Two modes, because they can do different things:
--   webhook — an incoming webhook URL, permanently bound to the one channel it
--             was created for. Simplest to set up, cannot choose a destination.
--   bot     — a bot token (xoxb-…) posting through chat.postMessage, which can
--             target any channel the bot is in, and can direct-message a user.
--
-- Credentials are stored encrypted (see src/infrastructure/crypto.js) and never
-- returned by the API. SLACK_WEBHOOK_URL still wins when set.
CREATE TABLE IF NOT EXISTS slack_config (
    id             INTEGER PRIMARY KEY CHECK (id = 1),
    mode           TEXT NOT NULL DEFAULT 'webhook' CHECK (mode IN ('webhook', 'bot')),
    webhook_cipher TEXT,
    webhook_hint   TEXT,
    bot_cipher     TEXT,
    bot_hint       TEXT,
    -- Channel (#security or C0123…) or user (@name or U0123…) in bot mode.
    destination    TEXT,
    -- Also direct-message the owners a vulnerability correlates to.
    notify_owners  INTEGER NOT NULL DEFAULT 0,
    enabled        INTEGER NOT NULL DEFAULT 0,
    updated_at     TEXT DEFAULT (datetime('now')),
    updated_by     TEXT
);
