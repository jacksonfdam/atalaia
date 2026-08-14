# Troubleshooting

| Symptom | Cause and fix |
|---------|---------------|
| `Refusing to install with npm` | The repo is pnpm-only — the lockfile carries the security overrides. `corepack enable && pnpm install`. |
| `UI_SESSION_SECRET is not set` | The console refuses to start without it. `openssl rand -hex 32`, or run `./scripts/atalaia.sh init`. |
| `Console is misconfigured: API_KEY is not set` | The console process did not get `API_KEY`. Export it or start via the launcher. |
| Console loads but every request 401s | `API_KEY` in the console's environment does not match the API's. |
| Port already in use | Another instance is running: `./scripts/atalaia.sh status`, then `down`. Or change `PORT` / `UI_PORT`. |
| Slack buttons do nothing | `SLACK_SIGNING_SECRET` missing, or Slack cannot reach the callback URL — locally that needs the ngrok tunnel. |
| **Send test** fails with `HTTP 404 (no_team)` or `(no_service)` | The webhook URL is not a live Slack webhook. Most often it is the `.env.example` placeholder left uncommented in `.env`: comment it out to configure Slack from the console, or paste the real URL. |
| A console section is read-only and **Save** answers `409` | Something in `.env` pins it — the environment always wins. `./scripts/atalaia.sh doctor` lists every value still equal to the `.env.example` placeholder, which is the usual cause. |
| Desktop notifications never appear although the browser says *Allowed* | The operating system also has to let the browser through: macOS System Settings → Notifications, and Do Not Disturb / Focus off. The browser reports success for a notification the OS then swallows. |
| The console shows *Blocked* after you allowed notifications in site settings | Come back to the tab — the console re-reads the permission on focus. If it still says blocked, the site permission was not actually changed. |
| Feed shows as failing under Sources | Upstream scraping target changed or is rate-limiting. The cycle continues; other feeds are unaffected. Disable it from the Sources page if it stays broken. |
| GHSA returns 403 | Unauthenticated GitHub calls get 60 requests/hour per IP. Set `GITHUB_TOKEN`. |
| `Cannot decrypt the token for "…"` | `TOKEN_ENCRYPTION_KEY` (or `API_KEY`, when it is the fallback) is not the value the token was stored with. Save the token again. |
| `GitHub rejected the token for this organization` | The token expired or cannot see that organization. Replace it under **Settings → Organizations**. |
| `DATABASE_URL is not set` | Atalaia has no database of its own. `supabase start` locally, then put the connection string in `.env`. |
| A container dies with `ECONNREFUSED 127.0.0.1:5432x` | Inside a container, `127.0.0.1` is that container. Start with `./scripts/atalaia.sh up`, which translates the loopback host, or export `DATABASE_URL` with `host.docker.internal` before a bare `docker compose up`. |
| The queue never picks anything up | Nothing is consuming it. Check the worker: `./scripts/atalaia.sh logs atalaia-worker`. The API only enqueues. |
| Odd `prepared statement` or `LISTEN` errors | `DATABASE_URL` points at Supabase's 6543 transaction pooler. Use the session connection on 5432; `doctor` flags this. |
| A scan says `409` and nothing is running | A worker was killed mid-job (rebuilding the containers does this), so the job is still `active` and an exclusive queue refuses new work until its expiry window passes. `atalaia repo scan-cancel`, or `DELETE /api/v1/repositories/scan-all`. |
| `LOG_LEVEL=... is not a pino level` | Only `trace debug info warn error fatal silent` exist. The service carries on at `info` rather than refusing to boot. |
| No console bundle in the image | `./scripts/atalaia.sh up --build`. |
| `atalaia` (CLI) cannot reach the API | It is an HTTP client now: export `API_KEY`, and `ATALAIA_API_URL` if the API is not on `localhost:3000`. |
