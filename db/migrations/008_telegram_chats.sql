-- Chats that have talked to the bot.
--
-- A chat id is not something anyone can look up: Telegram hands it out when a
-- conversation happens, and until then "chat not found" is all you get. So the
-- bot remembers whoever writes to it, and the console offers the ids instead of
-- asking somebody to find them with a third-party bot.
--
-- No credential here: a chat id identifies a destination, not a permission. It
-- is useless without the bot token.
CREATE TABLE IF NOT EXISTS telegram_chats (
    chat_id       text PRIMARY KEY,
    -- 'private', 'group', 'supergroup' or 'channel', as Telegram reports it.
    type          text,
    title         text,
    username      text,
    first_seen_at timestamptz NOT NULL DEFAULT now(),
    last_seen_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_telegram_chats_last_seen ON telegram_chats (last_seen_at DESC);
