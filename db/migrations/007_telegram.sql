-- Telegram, and where its buttons come back to.
--
-- One row, always id 1, like every other integration. The bot token is a
-- credential and is encrypted; the webhook secret is one Atalaia generates
-- itself and hands to Telegram, which returns it on every callback — that is
-- the whole of the authentication on that endpoint, so it is encrypted too.
--
-- webhook_url is what Telegram was last told, kept so a restart can tell
-- whether the tunnel handed out a different hostname and only re-register when
-- it did.
CREATE TABLE IF NOT EXISTS telegram_config (
    id                  integer PRIMARY KEY CHECK (id = 1),
    bot_token_cipher    text,
    bot_token_hint      text,
    -- Channel (@securityfeed), group (-1001234567890) or a user's own chat id.
    chat_id             text,
    -- Also message the owners a vulnerability correlates to, in their own chat.
    notify_owners       boolean NOT NULL DEFAULT false,
    webhook_secret_cipher text,
    webhook_url         text,
    webhook_set_at      timestamptz,
    enabled             boolean NOT NULL DEFAULT false,
    updated_at          timestamptz NOT NULL DEFAULT now(),
    updated_by          text
);

-- An owner reachable on Telegram, the same way slack_user_id makes one
-- reachable on Slack. Numeric id rather than @username: a bot can only message
-- a chat id, and a username is not one.
ALTER TABLE system_owners ADD COLUMN IF NOT EXISTS telegram_chat_id text;
