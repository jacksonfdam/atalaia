-- Where alerts go, and which model explains them.
--
-- One row each, always id 1: there is a single configuration per integration,
-- and a one-row table keeps the update a plain UPSERT instead of a key/value
-- shuffle across a dozen rows of the settings table.
--
-- Every credential is stored encrypted (see src/infrastructure/crypto.js) and
-- never returned by the API — only a four-character hint is. The matching
-- environment variables still win when set.

CREATE TABLE IF NOT EXISTS email_config (
    id             integer PRIMARY KEY CHECK (id = 1),
    provider       text NOT NULL DEFAULT 'smtp',
    host           text,
    port           integer,
    username       text,
    secret_cipher  text,
    secret_hint    text,
    from_address   text,
    recipients     text,
    template       text NOT NULL DEFAULT 'professional',
    enabled        boolean NOT NULL DEFAULT false,
    updated_at     timestamptz NOT NULL DEFAULT now(),
    updated_by     text
);

-- Two modes, because they can do different things:
--   webhook — an incoming webhook URL, permanently bound to the one channel it
--             was created for. Simplest to set up, cannot choose a destination.
--   bot     — a bot token (xoxb-…) posting through chat.postMessage, which can
--             target any channel the bot is in, and can direct-message a user.
--
-- The signing secret verifies what Slack sends back when someone clicks
-- Acknowledge or Resolve; the app token and id are used in development to point
-- the app's Request URL at the current tunnel.
CREATE TABLE IF NOT EXISTS slack_config (
    id                integer PRIMARY KEY CHECK (id = 1),
    mode              text NOT NULL DEFAULT 'webhook' CHECK (mode IN ('webhook', 'bot')),
    webhook_cipher    text,
    webhook_hint      text,
    bot_cipher        text,
    bot_hint          text,
    -- Channel (#security or C0123…) or user (@name or U0123…) in bot mode.
    destination       text,
    -- Also direct-message the owners a vulnerability correlates to.
    notify_owners     boolean NOT NULL DEFAULT false,
    signing_cipher    text,
    signing_hint      text,
    app_token_cipher  text,
    app_token_hint    text,
    app_id            text,
    enabled           boolean NOT NULL DEFAULT false,
    updated_at        timestamptz NOT NULL DEFAULT now(),
    updated_by        text
);

-- Teams has no bot mode here: a Workflows webhook is bound to the channel it
-- was created in, which is the whole of what it offers an outside service. The
-- URL is a credential — anyone holding it can post there — so it is encrypted
-- like any other.
CREATE TABLE IF NOT EXISTS teams_config (
    id              integer PRIMARY KEY CHECK (id = 1),
    webhook_cipher  text,
    webhook_hint    text,
    enabled         boolean NOT NULL DEFAULT false,
    updated_at      timestamptz NOT NULL DEFAULT now(),
    updated_by      text
);

-- A local provider needs no key at all, which is the point of offering one.
CREATE TABLE IF NOT EXISTS llm_config (
    id              integer PRIMARY KEY CHECK (id = 1),
    provider        text NOT NULL DEFAULT 'ollama',
    model           text,
    base_url        text,
    api_key_cipher  text,
    api_key_hint    text,
    enabled         boolean NOT NULL DEFAULT false,
    updated_at      timestamptz NOT NULL DEFAULT now(),
    updated_by      text
);
