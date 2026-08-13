-- Which model writes the plain-English explanation attached to an alert.
--
-- One row, always id 1, same shape as email_config and slack_config. The API
-- key is encrypted (see src/infrastructure/crypto.js) and never returned; a
-- local provider needs no key at all, which is the point of offering one.
CREATE TABLE IF NOT EXISTS llm_config (
    id            INTEGER PRIMARY KEY CHECK (id = 1),
    provider      TEXT NOT NULL DEFAULT 'ollama',
    model         TEXT,
    base_url      TEXT,
    api_key_cipher TEXT,
    api_key_hint  TEXT,
    enabled       INTEGER NOT NULL DEFAULT 0,
    updated_at    TEXT DEFAULT (datetime('now')),
    updated_by    TEXT
);
