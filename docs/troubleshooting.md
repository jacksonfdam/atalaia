# Troubleshooting

| Symptom | Cause and fix |
|---------|---------------|
| `Refusing to install with npm` | The repo is pnpm-only — the lockfile carries the security overrides. `corepack enable && pnpm install`. |
| `Refusing to start: passkey configuration is invalid` | `WEBAUTHN_ORIGINS` is not under `WEBAUTHN_RP_ID`, is plain `http` outside loopback, or `WEBAUTHN_RP_ID` has a scheme or a port. The log names the value. See [Authentication](authentication.md). |
| Nobody can sign in after a domain change | `WEBAUTHN_RP_ID` changed, so every passkey registered under the old one is orphaned. The API logs both values at boot. Restore the old value, or have everyone re-enroll with a recovery code. |
| The console offers a setup form on an installation that already has accounts | The `auth.bootstrapped` row is missing from `settings`. Whoever registers next becomes an administrator — existing accounts are untouched. |
| Every passkey and every recovery code is gone | `AUTH_ALLOW_BREAKGLASS=true` plus `SETUP_PASSWORD` enrolls a passkey for an existing account. Turn it back off afterwards. |
| `Signature counter went backwards` | The authenticator reported a lower use count than last time, which is what a cloned key looks like. The sign-in is refused and `auth.counter_regressed` is written. A synced passkey reporting zero forever is normal and is accepted. |
| Console requests fail with `Missing console request header` | Something other than the console's own JavaScript is posting to it. That header is the CSRF check. |
| `Console is misconfigured: API_KEY is not set` | The console process did not get `API_KEY`. Export it or start via the launcher. |
| Console loads but every request 401s | `API_KEY` in the console's environment does not match the API's. |
| Port already in use | Another instance is running: `./scripts/atalaia.sh status`, then `down`. Or change `PORT` / `UI_PORT`. |
| Slack buttons do nothing | `SLACK_SIGNING_SECRET` missing, or Slack cannot reach the callback URL — locally that needs a tunnel (`TUNNEL_PROVIDER`). |
| Telegram buttons do nothing | No webhook registered, or it points at a tunnel that has since changed. **Settings → Telegram** shows where Telegram calls and its last delivery error; **Register webhook** points it here again. |
| Telegram says "chat not found" | The bot is not in that group or channel, or the chat id is wrong. Add the bot, then use the numeric id — groups start with `-100`. |
| Telegram says "bot can't initiate conversation with a user" | Send `/start` to the bot from that account first. A bot cannot open a conversation. |
| `setWebhook`: "Failed to resolve host" after a restart | `PUBLIC_URL` is pinned to an old tunnel hostname. Those change every run and `PUBLIC_URL` wins over the tunnel — unset it and keep `TUNNEL_PROVIDER`. The console says so under **Settings → General**. |
| `setWebhook`: "Failed to resolve host" | The address is not one the internet can reach — `localhost`, a private IP, or a container name like `atalaia`. Set `PUBLIC_URL` to a real hostname, or `TUNNEL_PROVIDER=cloudflared` and let the tunnel supply one. **Settings → General** shows what this instance is currently using. |
| `setWebhook` refuses the port | Telegram calls 443, 80, 88 and 8443 only. Put a reverse proxy in front, or use a tunnel. |
| `getUpdates` answers 409 | A webhook is registered; the two are mutually exclusive. Remove it (`DELETE /api/v1/settings/telegram/webhook`), read what you need, register it again. |
| **Send test** fails with `HTTP 404 (no_team)` or `(no_service)` | The webhook URL is not a live Slack webhook. Most often it is the `.env.example` placeholder left uncommented in `.env`: comment it out to configure Slack from the console, or paste the real URL. |
| A console section is read-only and **Save** answers `409` | Something in `.env` pins it — the environment always wins. `./scripts/atalaia.sh doctor` lists every value still equal to the `.env.example` placeholder, which is the usual cause. |
| Desktop notifications never appear although the browser says *Allowed* | The operating system also has to let the browser through: macOS System Settings → Notifications, and Do Not Disturb / Focus off. The browser reports success for a notification the OS then swallows. |
| The console shows *Blocked* after you allowed notifications in site settings | Come back to the tab — the console re-reads the permission on focus. If it still says blocked, the site permission was not actually changed. |
| **Test model** answers gibberish, or nothing at all | The model name ends in `-base`. A base model continues text instead of answering it; the test says so next to the sample. Switch to the instruct or chat variant. |
| **Test model** reports a 404 on the endpoint | The URL is a chat path, not a base. Atalaia strips the usual ones, but a path it does not recognise is sent as given — use the provider's base URL. |
| The model works in `curl` but not from Atalaia | Atalaia runs in a container, where `localhost` is the container. A refused loopback is retried against `host.docker.internal` automatically; if the model listens on `127.0.0.1` only, bind it to all interfaces. |
| Feed shows as failing under Sources | Upstream scraping target changed or is rate-limiting. The cycle continues; other feeds are unaffected. Disable it from the Sources page if it stays broken. |
| GHSA returns 403 | Unauthenticated GitHub calls get 60 requests/hour per IP. Set `GITHUB_TOKEN`. |
| `Cannot decrypt the token for "…"` | `TOKEN_ENCRYPTION_KEY` (or `API_KEY`, when it is the fallback) is not the value the token was stored with. Save the token again. |
| `GitHub rejected the token for this organization` | The token expired or cannot see that organization. Replace it under **Settings → Organizations**. |
| `DATABASE_URL is not set` | Atalaia has no database of its own. Start one — `docker run -d -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:17` — and put the connection string in `.env`. |
| A container dies with `ECONNREFUSED 127.0.0.1:5432x` | Inside a container, `127.0.0.1` is that container. Start with `./scripts/atalaia.sh up`, which translates the loopback host, or export `DATABASE_URL` with `host.docker.internal` before a bare `docker compose up`. |
| The queue never picks anything up | Nothing is consuming it. Check the worker: `./scripts/atalaia.sh logs atalaia-worker`. The API only enqueues. |
| Odd `prepared statement` or `LISTEN` errors | `DATABASE_URL` points at a transaction-mode pooler, usually on port 6543. Use the session connection on 5432; `doctor` flags this. |
| A scan says `409` and nothing is running | A worker was killed mid-job (rebuilding the containers does this), so the job is still `active` and an exclusive queue refuses new work until its expiry window passes. `atalaia repo scan-cancel`, or `DELETE /api/v1/repositories/scan-all`. |
| `LOG_LEVEL=... is not a pino level` | Only `trace debug info warn error fatal silent` exist. The service carries on at `info` rather than refusing to boot. |
| No console bundle in the image | `./scripts/atalaia.sh up --build`. |
| `atalaia` (CLI) cannot reach the API | It is an HTTP client now: export `API_KEY`, and `ATALAIA_API_URL` if the API is not on `localhost:3000`. |
