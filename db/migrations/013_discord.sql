-- Where alerts go on Discord.
--
-- One row, always id 1, like every other integration: there is a single
-- configuration per channel and a one-row table keeps the update a plain UPSERT.
--
-- The webhook URL is a credential — anyone holding it can post in that channel
-- and there is no way to scope it further — so it is stored encrypted through
-- src/infrastructure/crypto.js and never returned by the API. Only the last four
-- characters come back, in webhook_hint.
--
-- DISCORD_WEBHOOK_URL in the environment still wins when set, and a write that
-- would have no effect is refused with 409 rather than silently ignored.

CREATE TABLE IF NOT EXISTS discord_config (
    id              integer PRIMARY KEY CHECK (id = 1),
    webhook_cipher  text,
    webhook_hint    text,
    enabled         boolean NOT NULL DEFAULT false,
    updated_at      timestamptz NOT NULL DEFAULT now(),
    updated_by      text
);
