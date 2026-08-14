# Configuration

Configuration comes from `.env` (see [`.env.example`](../.env.example)) plus `config.json` for feed URLs and the technology filter. Values in `config.json` support `${ENV_VAR}` substitution, and a few keys (`CRON_SCHEDULE`, `SLACK_ENABLED`) can be overridden from the environment.

**Optional integrations ship commented out, and should stay that way until you have real values.** A variable set here beats the console, so a placeholder webhook or SMTP host is not harmless: Atalaia treats it as deliberate configuration, greys out the matching console section, and fails every **Send test** against it. `./scripts/atalaia.sh doctor` flags any value in `.env` that is still the one from `.env.example`.

## Core

| Variable | Default | Description |
|----------|---------|-------------|
| `API_KEY` | — | **Required.** Key for every `/api/v1/*` request (`X-API-Key` header). |
| `PORT` | `3000` | API port. |
| `HOST` | `0.0.0.0` | API bind address. |
| `NODE_ENV` | — | `production` disables the ngrok/Slack dev bootstrap. |
| `LOG_LEVEL` | `info` | Pino level: `trace`…`fatal`. |
| `DB_PATH` | `data/atalaia.db` | SQLite file. `/app/data/atalaia.db` in Docker. |
| `CRON_SCHEDULE` | `0 * * * *` | Monitoring cycle; overrides `config.json`. |
| `CORS_ORIGINS` | `http://localhost:3000` | Comma-separated allowed origins. |

## Console

| Variable | Default | Description |
|----------|---------|-------------|
| `UI_PASSWORD` | — | **Required.** Console sign-in password. |
| `UI_SESSION_SECRET` | — | **Required.** Cookie signing key — `openssl rand -hex 32`. |
| `UI_PORT` | `3001` | Console port. |
| `UI_HOST` | `0.0.0.0` | Console bind address. |
| `ATALAIA_API_URL` | `http://localhost:3000` | API base URL the console proxies to. |
| `BFF_TIMEOUT_MS` | `120000` | Upstream timeout — a repository scan can take minutes. |
| `BFF_URL` | `http://localhost:3001` | Vite dev-server proxy target. Development only. |

## Chat integrations

| Variable | Default | Description |
|----------|---------|-------------|
| `SLACK_ENABLED` | `false` | Master switch; overrides `config.json`. |
| `SLACK_WEBHOOK_URL` | — | Incoming webhook for alerts. |
| `SLACK_SIGNING_SECRET` | — | Verifies interactive button callbacks. Required for Acknowledge/Resolve. |
| `SLACK_APP_TOKEN` | — | Dev only: lets Atalaia update the app's Request URL. |
| `SLACK_APP_ID` | — | Dev only: the app to update. |
| `TEAMS_WEBHOOK_URL` | — | Microsoft Teams Workflows webhook. Pins the integration to the environment. |
| `TEAMS_ENABLED` | — | Forces Teams delivery on or off wherever it is configured. |
| `NGROK_AUTH_TOKEN` | — | Dev only: public tunnel for Slack callbacks. |
| `NGROK_REGION` | `auto` | ngrok region. |

## Feeds and scanning

| Variable | Default | Description |
|----------|---------|-------------|
| `FEED_TIMEOUT_MS` | `15000` | Per-feed HTTP timeout. |
| `FEED_DELAY_MS` | `2000` | Pause between feeds in a cycle — keeps scraped sources happy. |
| `FEED_HEALTH_TTL_MS` | `60000` | Cache TTL for `/api/v1/feeds/health`. |
| `OPENCVE_API_URL` | — | OpenCVE instance for vendor/product lookup. |
| `OPENCVE_API_TOKEN` | — | OpenCVE token. |
| `GITHUB_TOKEN` | — | Fallback token for the GHSA feed and for repository scanning when an organization has none of its own. |
| `TOKEN_ENCRYPTION_KEY` | falls back to `API_KEY` | Key used to encrypt organization tokens at rest. Change it and the stored tokens become unreadable. |
| `MITRE_MAX_RECORDS` | `25` | CVE records fetched per cycle from the MITRE delta — one request each. |
| `REDHAT_PAGE_SIZE` | `100` | CVEs per Red Hat Security Data page. |
| `USN_LIMIT` | `10` | Ubuntu notices per cycle. A single kernel notice can carry hundreds of CVEs. |

## LLM summaries

Normally configured from the console (**Settings → Model**). These still work and **take precedence** — setting `LLM_PROVIDER` turns the console section read-only.

| Variable | Default | Description |
|----------|---------|-------------|
| `LLM_PROVIDER` | — | `ollama`, `lmstudio`, `openai`, `anthropic`, `gemini`, `openrouter`, `groq` or `custom`. Unset leaves it to the console. |
| `OPENAI_API_KEY` | — | Key for whichever hosted provider is selected. |
| `OPENAI_MODEL` | per provider | Model name. |
| `OLLAMA_URL` | `http://localhost:11434` | Local Ollama endpoint. |
| `OLLAMA_MODEL` | `llama3.1` | Ollama model. |

## Weekly email report

Delivery is normally configured from the console (**Settings → Email**), which stores the provider and its credential in the database. These variables still work and **take precedence** — set `SMTP_HOST` and the console section turns read-only, so a deployment that pins credentials in the environment keeps behaving exactly as before.

| Variable | Default | Description |
|----------|---------|-------------|
| `SMTP_HOST` | — | SMTP server. Setting it pins the whole email configuration to the environment. |
| `SMTP_PORT` | `587` | SMTP port. |
| `SMTP_USER` / `SMTP_PASS` | — | SMTP credentials. |
| `EMAIL_FROM` | `atalaia@localhost` | Sender address. |
| `EMAIL_RECIPIENTS` | — | Comma-separated recipients. |
| `EMAIL_TEMPLATE` | `professional` | `professional` or `minimal`. |
| `WEEKLY_REPORT_CRON` | `0 9 * * 1` | Digest schedule — Mondays at 09:00. |

## config.json

| Key | Description |
|-----|-------------|
| `cronSchedule` | Monitoring interval. `CRON_SCHEDULE` wins. |
| `slack.enabled` / `slack.webhookUrl` | Slack switch and webhook (env-substituted). |
| `feeds.*` | Source URLs for CISA, Snyk, VulDB. |
| `opencve.*` | OpenCVE API URL and token (env-substituted). |
| `providers[]` | Git providers (org key, type, token) pinned in configuration. Organizations registered in the console take precedence over an entry with the same key. |
| `repositories.autoScan` / `scanCron` | Scheduled dependency scanning. |
| `repositories.autoFilterFromDeps` | Extend the technology filter from scanned dependencies. |
| `filterSettings.enabled` / `technologies[]` | The stack filter applied to every feed item. |

## Rules that hold everywhere

The same handful of decisions recur across every feature; knowing them explains most of the behaviour without reading the code.

**Environment beats database beats file.** Anything set as an environment variable wins and turns the matching console field read-only — a deployment can always pin a value, and a write that would have no effect is refused with `409` rather than silently stored. Next comes what the console wrote to SQLite, and last `config.json`, which is the committed default.

**Secrets are encrypted at rest and never come back.** GitHub tokens, SMTP passwords, Slack credentials and LLM keys are stored with AES-256-GCM keyed by `TOKEN_ENCRYPTION_KEY` (or `API_KEY`). The API returns whether one is held and its last four characters, never the value. Changing provider drops the stored key — a SendGrid key is not a Mailgun password.

**Reads only, on everything external.** GitHub, the vulnerability feeds and the package registries are read and never written to.

**Long work runs detached.** A fleet scan, a version check or a monitoring cycle answers `202` immediately, refuses a second concurrent run with `409`, and reports progress on a `GET` at the same path. Nothing that outlives an HTTP timeout is run inside a request.

**Deleting is soft, and stays.** Repositories, organizations, owners and dependencies are marked deleted rather than removed, and an import will not resurrect one behind your back — only asking for it by name will.

**Enabled is the operator's switch.** Re-importing or re-scanning never flips it, and a disabled repository stops counting towards exposure and relevance.

**Counts and filters share one definition.** Where a header states a number — repositories exposed, CVEs affecting you, dependencies behind — the same SQL backs the number and the rows beneath it, so the two cannot disagree.

**Nothing is claimed that was not verified.** A source that answers with zero items is reported as `EMPTY`, not healthy; a version that cannot be compared answers `unknown` with the reason instead of guessing; a repository that was never scanned says so instead of showing as clean.
