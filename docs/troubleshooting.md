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
| Docker build is slow the first time | `better-sqlite3` is compiled from source — no musl prebuilds. Later builds are cached. |
| No console bundle in local mode | `pnpm --filter atalaia-console run build`, or `./scripts/atalaia.sh up --local --build`. |
