-- The rest of the Slack app's credentials, so the whole integration can be
-- configured in one place instead of half in the console and half in .env.
--
--   signing secret — verifies the requests Slack sends back when someone clicks
--                    Acknowledge or Resolve. Inbound, not outbound.
--   app token + id — used in development to point the app's Request URL at the
--                    current ngrok tunnel (apps.manifest.update).
--
-- Both secrets are encrypted; the app ID is not a secret.
ALTER TABLE slack_config ADD COLUMN signing_cipher TEXT;
ALTER TABLE slack_config ADD COLUMN signing_hint TEXT;
ALTER TABLE slack_config ADD COLUMN app_token_cipher TEXT;
ALTER TABLE slack_config ADD COLUMN app_token_hint TEXT;
ALTER TABLE slack_config ADD COLUMN app_id TEXT;
