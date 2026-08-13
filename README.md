# Atalaia

**Proactive vulnerability intelligence for engineering teams.**

Atalaia is an automated security monitoring service that aggregates CVE data from multiple authoritative sources, filters it against your technology stack, and delivers actionable alerts — so your team can respond to threats before they become incidents.

Built for teams that ship fast and need security to keep up.

---

## Why Atalaia?

Most vulnerability scanners are reactive — they tell you what's wrong *after* the fact. Atalaia continuously monitors public feeds and notifies your team the moment a relevant CVE is published, with severity context, exploit status, and one-click triage.

- **14 intelligence sources** in a single pipeline — NVD, CISA KEV, MITRE, GHSA, EUVD, OpenCVE, Snyk, VulDB and vendor/regional feeds — each one switchable at runtime
- **Read-only GitHub import** — several organizations, each with its own token, and the technologies every repository actually uses
- **Stack-aware filtering** — only see vulnerabilities that affect *your* technologies
- **Slack-native workflow** — Block Kit alerts with Acknowledge/Resolve buttons, no context-switching
- **Weekly executive reports** — severity-grouped HTML emails for stakeholders
- **Zero-config deduplication** — same CVE from multiple sources? Merged automatically with source priority
- **LLM-powered summaries** — plain-English explanations via OpenAI or local Ollama

---

## Quick Start

```bash
git clone https://github.com/jacksonfdam/atalaia.git
cd atalaia

./scripts/atalaia.sh up
```

That single command is the whole setup. It creates `.env` from `.env.example` if it is missing, generates the secrets that have no sensible default (`API_KEY`, `UI_SESSION_SECRET`, `UI_PASSWORD`), starts the API and the management console, and waits until both answer their health endpoints. It uses Docker when the daemon is running and falls back to local Node processes when it is not.

```
  API      http://localhost:3000        (health: /health)
  Console  http://localhost:3001        (password: UI_PASSWORD in .env)
```

Nothing else is required to get a first monitoring cycle running. Slack, email and LLM summaries stay off until you fill in their credentials — see [Configuration](#configuration).

---

## Running Atalaia

Atalaia is two services: the **API** (`src/`, port 3000) and the **management console** (`ui/`, port 3001). They can run together or apart, in Docker or as plain Node processes.

### The launcher

`scripts/atalaia.sh` is the supported way to start both, in either mode. It exists because the two services need the same secrets and the console server — unlike the API — does not read `.env` on its own, so something has to wire the values through.

```bash
./scripts/atalaia.sh <command> [options]
```

| Command | What it does |
|---------|--------------|
| `up` | Start API + console. Docker when available, local otherwise. |
| `down` | Stop everything the launcher started (both modes). |
| `restart` | `down` followed by `up`. |
| `status` | Health of both services and what is currently running. |
| `logs [api\|console]` | Follow logs — `docker compose logs` in Docker mode, `.run/*.log` locally. |
| `init` | Create `.env` from `.env.example` and generate missing secrets. |
| `install` | Install dependencies with pnpm. |
| `build` | Build the console bundle and the CLI. |
| `test` | Run the test suite. |
| `doctor` | Check prerequisites (Node, pnpm, Docker) and configuration. |

| Option | Effect |
|--------|--------|
| `--docker` | Force Docker mode. |
| `--local` | Force local mode, no Docker. |
| `--dev` | Local mode with hot-reload (nodemon). Implies `--local`. |
| `--build` | Rebuild images / the console bundle before starting. |
| `--no-console` | Start the API only. |
| `--skip-install` | Local mode: skip `pnpm install`. |
| `-h`, `--help` | Full usage. |

```bash
./scripts/atalaia.sh up --docker --build   # rebuild images and start
./scripts/atalaia.sh up --local --dev      # hot-reload API + console
./scripts/atalaia.sh up --no-console       # API only
./scripts/atalaia.sh logs api
./scripts/atalaia.sh status
./scripts/atalaia.sh down
```

The same commands are available as package scripts: `pnpm run up`, `pnpm run up:docker`, `pnpm run up:local`, `pnpm run down`, `pnpm run status`, `pnpm run logs`, `pnpm run doctor`.

**Ports.** The launcher reads `PORT` and `UI_PORT` from `.env` — or from the environment, which wins — so `PORT=8000 ./scripts/atalaia.sh up` moves the API and its health check together. `docker-compose.yml` interpolates the same variables, so the published port never drifts from the port the process listens on.

### With Docker

Requirements: Docker with Compose v2.

```bash
cp .env.example .env          # or: ./scripts/atalaia.sh init
docker compose up -d --build
docker compose ps             # both services should be "healthy"
docker compose logs -f
docker compose down
```

Two containers are started:

| Service | Image | Port | Health |
|---------|-------|------|--------|
| `atalaia` | multi-stage `node:24-alpine`, built from `Dockerfile` | `3000` | `GET /health` |
| `atalaia-console` | multi-stage `node:24-alpine`, built from `ui/Dockerfile` | `3001` | `GET /healthz` |

The console waits for the API to report healthy (`depends_on: service_healthy`) and reaches it over the compose network at `http://atalaia:3000` — never over `localhost`, which inside a container points at the container itself. The SQLite database is bind-mounted at `./data`, so it survives `docker compose down`.

`better-sqlite3` has no musl prebuilds and is compiled from source in the builder stage; the first build takes a few minutes, later builds hit the layer cache.

### Without Docker

Requirements: Node.js 24+ and pnpm 11+ (`corepack enable` gives you pnpm).

This repository is pnpm-managed and a `preinstall` hook refuses npm and yarn: the lockfile carries security overrides that npm silently drops.

```bash
corepack enable
pnpm install                                  # root + ui workspaces

cp .env.example .env                          # fill in API_KEY, UI_PASSWORD, UI_SESSION_SECRET
# openssl rand -hex 32   generates a good value for the last two

pnpm start                                    # API on :3000
```

In a second terminal, for the console:

```bash
pnpm --filter atalaia-console run build         # build the client bundle once
node ui/server/index.js                       # console on :3001
```

The console server reads `API_KEY`, `UI_PASSWORD` and `UI_SESSION_SECRET` from its process environment and does not load `.env` itself. Either export them, or let `./scripts/atalaia.sh up --local` pass them through for you.

### Development mode

```bash
./scripts/atalaia.sh up --local --dev     # API with nodemon + console on :3001
```

Or by hand, one process per terminal:

```bash
pnpm run dev                            # API, hot-reload via nodemon
node ui/server/index.js                 # console BFF (auth + API-key proxy)
pnpm --filter atalaia-console run dev:client   # Vite dev server on :5173
```

With Vite running, open **http://localhost:5173** — it proxies `/bff` and `/auth` to the console server (`BFF_URL`, default `http://localhost:3001`), so cookies stay same-origin from the browser's point of view.

In non-production (`NODE_ENV !== 'production'`) the API also tries to open an ngrok tunnel and point your Slack app's Request URL at it, so Slack's Acknowledge/Resolve buttons reach your laptop. It needs `NGROK_AUTH_TOKEN`, `SLACK_APP_TOKEN` and `SLACK_APP_ID`; without them it logs a warning and carries on.

### Local process state

Local mode writes to `.run/` (git-ignored):

```
.run/api.pid        .run/api.log
.run/console.pid    .run/console.log
```

`up` refuses to start a service whose PID file points at a live process, so it is safe to run twice.

---

## Configuration

Configuration comes from `.env` (see [`.env.example`](.env.example)) plus `config.json` for feed URLs and the technology filter. Values in `config.json` support `${ENV_VAR}` substitution, and a few keys (`CRON_SCHEDULE`, `SLACK_ENABLED`) can be overridden from the environment.

### Core

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

### Console

| Variable | Default | Description |
|----------|---------|-------------|
| `UI_PASSWORD` | — | **Required.** Console sign-in password. |
| `UI_SESSION_SECRET` | — | **Required.** Cookie signing key — `openssl rand -hex 32`. |
| `UI_PORT` | `3001` | Console port. |
| `UI_HOST` | `0.0.0.0` | Console bind address. |
| `ATALAIA_API_URL` | `http://localhost:3000` | API base URL the console proxies to. |
| `BFF_TIMEOUT_MS` | `120000` | Upstream timeout — a repository scan can take minutes. |
| `BFF_URL` | `http://localhost:3001` | Vite dev-server proxy target. Development only. |

### Slack

| Variable | Default | Description |
|----------|---------|-------------|
| `SLACK_ENABLED` | `false` | Master switch; overrides `config.json`. |
| `SLACK_WEBHOOK_URL` | — | Incoming webhook for alerts. |
| `SLACK_SIGNING_SECRET` | — | Verifies interactive button callbacks. Required for Acknowledge/Resolve. |
| `SLACK_APP_TOKEN` | — | Dev only: lets Atalaia update the app's Request URL. |
| `SLACK_APP_ID` | — | Dev only: the app to update. |
| `NGROK_AUTH_TOKEN` | — | Dev only: public tunnel for Slack callbacks. |
| `NGROK_REGION` | `auto` | ngrok region. |

### Feeds and scanning

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

### LLM summaries

| Variable | Default | Description |
|----------|---------|-------------|
| `LLM_PROVIDER` | — | `openai` or `ollama`. Unset disables explanations. |
| `OPENAI_API_KEY` | — | Required for `openai`. |
| `OPENAI_MODEL` | `gpt-4o-mini` | OpenAI model. |
| `OLLAMA_URL` | `http://localhost:11434` | Local Ollama endpoint. |
| `OLLAMA_MODEL` | `llama2` | Ollama model. |

### Weekly email report

| Variable | Default | Description |
|----------|---------|-------------|
| `SMTP_HOST` | — | SMTP server. Email is disabled without it. |
| `SMTP_PORT` | `587` | SMTP port. |
| `SMTP_USER` / `SMTP_PASS` | — | SMTP credentials. |
| `EMAIL_FROM` | `atalaia@localhost` | Sender address. |
| `EMAIL_RECIPIENTS` | — | Comma-separated recipients. |
| `EMAIL_TEMPLATE` | `professional` | `professional` or `minimal`. |
| `WEEKLY_REPORT_CRON` | `0 9 * * 1` | Digest schedule — Mondays at 09:00. |

### config.json

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

---

## How It Works

```
┌─────────────┐     ┌──────────────┐     ┌───────────┐     ┌───────────┐
│  CVE Feeds  │────▶│  Filter by   │────▶│ Deduplicate│────▶│  Notify   │
│  (enabled   │     │  Tech Stack  │     │  & Merge   │     │  Slack +  │
│   sources)  │     │              │     │  (SQLite)  │     │  Email    │
└─────────────┘     └──────────────┘     └───────────┘     └───────────┘
     NVD                 config/              Source           Block Kit
     CISA KEV            technologies.json    priority         buttons
     MITRE / EUVD                             ranking          + weekly
     GHSA / OpenCVE                                            reports
     Snyk / VulDB
     …and the rest,
     off by default
```

1. **Scheduler** triggers monitoring on a configurable cron interval
2. **Feed aggregator** fetches all enabled sources concurrently — one feed failure never blocks others
3. **Tech filter** matches CVEs against your stack (case-insensitive, configurable at runtime)
4. **Deduplication** checks SQLite cache; merges multi-source CVEs using priority ranking
5. **Notification** sends Slack alerts with interactive buttons + optional LLM explanation
6. **Weekly digest** emails a severity-grouped report to stakeholders

A first cycle also runs immediately at startup, so a fresh install has data within a minute.

---

## Sources

Atalaia ships a catalog of the public vulnerability databases it knows about
(`config/vulnerability-databases.json`, kept in step with
[haxdoggy/vulnerability-databases](https://github.com/haxdoggy/vulnerability-databases)).
The catalog is deliberately larger than the set Atalaia collects: a database you
cannot collect is still worth seeing, along with the reason.

Each source with an adapter can be switched on or off at runtime, from the
console's **Sources** page or through the API. The choice is stored in the
database, so it survives a restart; sources you never touch keep following the
default shipped in the registry.

```bash
curl -X PATCH -H "X-API-Key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"enabled":true}' http://localhost:3000/api/v1/feeds/ubuntu

curl -H "X-API-Key: $API_KEY" http://localhost:3000/api/v1/feeds/catalog
```

| Source | Default | Notes |
|--------|---------|-------|
| `nvd` | on | CVSS, CWE and CPE enrichment. |
| `cisa` | on | Known Exploited Vulnerabilities — the only source that marks active exploitation. |
| `mitre` | on | Authoritative CVE records, read from `cvelistV5`'s delta. Capped by `MITRE_MAX_RECORDS`. |
| `opencve` | on | Vendor/product correlation. |
| `ghsa` | on | GitHub advisories, package-level precision. Needs `GITHUB_TOKEN` for a usable rate limit. |
| `euvd` | on | ENISA's European database. |
| `snyk` | on | Scraped. |
| `vuldb` | on | RSS; rarely carries a CVSS score. |
| `redhat` | off | Vendor source, for Red Hat and CentOS based images. |
| `ubuntu` | off | Vendor source, for Debian and Ubuntu based images. |
| `zdi` | off | Often published before a patch exists. |
| `certeu` | off | Regional, largely redundant with NVD. |
| `certfr` | off | Regional, French. |
| `cvedetails` | off | Blocks scrapers with a 403. |

A source that answers with zero items is reported as `EMPTY` rather than
healthy, and the health report shows how many of the items actually carry a
CVSS score — a feed can be alive and still be useless for triage.

---

## Organizations and repositories

Atalaia correlates CVEs against the code you actually ship, which means knowing
your repositories. Register a GitHub organization (or user) with a read-only
token and import them; several organizations with different tokens is the
normal case, and each token is stored encrypted and never returned by the API.

```bash
curl -X POST -H "X-API-Key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"login":"my-company","token":"ghp_…"}' \
  http://localhost:3000/api/v1/organizations

curl -X POST -H "X-API-Key: $API_KEY" \
  http://localhost:3000/api/v1/organizations/my-company/import
```

**Everything Atalaia does against GitHub is read-only.** It lists repositories,
reads their language breakdown and reads manifest files. Every request in the
provider goes through one GET helper; nothing is ever written back — no issues,
no commits, no status checks.

What the importer does:

- Lists every repository the token can see, including archived ones, which are
  imported **switched off** rather than skipped.
- Records the primary language, the language breakdown, topics and description.
- Leaves repositories you removed removed — a re-import does not resurrect them.
- Leaves your enable/disable choice alone — a re-import does not flip it back.

Per repository you get two independent views of its technologies:
**languages and topics** as reported by GitHub, and **ecosystems** derived from
the manifests found by a dependency scan. A repository can report "TypeScript"
and still carry its risk inside a Dockerfile, so the two are shown separately.

Removing an organization also removes the repositories imported under it — they
would otherwise be left with no credential that reaches them.

Tokens need read access only: `public_repo` (or `repo` for private ones) on a
classic token, or *Contents: read-only* and *Metadata: read-only* on a
fine-grained one.

---

## REST API

Everything under `/api/v1` requires the `X-API-Key` header. `/health` is public; `/api/v1/slack/actions` authenticates by Slack signature instead.

```bash
curl -H "X-API-Key: $API_KEY" http://localhost:3000/api/v1/vulnerabilities
curl -H "X-API-Key: $API_KEY" "http://localhost:3000/api/v1/vulnerabilities?severity=CRITICAL"
curl -H "X-API-Key: $API_KEY" http://localhost:3000/api/v1/stats

curl -X PATCH -H "X-API-Key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"status":"ACKNOWLEDGED","changedBy":"security-team"}' \
  http://localhost:3000/api/v1/vulnerabilities/CVE-2024-0001/status
```

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/health` | Liveness. No auth. |
| `GET` | `/api/v1/stats` | Counts by severity, status and source. |
| `POST` | `/api/v1/query` | Query by technology list. |
| `GET` | `/api/v1/vulnerabilities` | List with filters and pagination. |
| `GET` | `/api/v1/vulnerabilities/:cveId` | One CVE, with explanation and timeline. |
| `PATCH` | `/api/v1/vulnerabilities/:cveId/status` | Acknowledge / resolve. |
| `GET` | `/api/v1/technologies` | Current stack filter. |
| `POST` | `/api/v1/technologies` | Update the stack filter. |
| `GET` | `/api/v1/feeds` | Every source, its state and its catalog entry. |
| `PATCH` | `/api/v1/feeds/:name` | Enable or disable a source (`{ "enabled": true }`). |
| `DELETE` | `/api/v1/feeds/:name/override` | Follow the registry default again. |
| `GET` | `/api/v1/feeds/catalog` | Every public database Atalaia knows about, collected or not. |
| `GET` | `/api/v1/feeds/health` | Per-feed items, CVSS coverage, latency, failure reason. |
| `GET` `POST` | `/api/v1/organizations` | List / register an organization (`{ login, key?, name?, token? }`). |
| `GET` `PATCH` `DELETE` | `/api/v1/organizations/:key` | Inspect / update token and state / remove with its repositories. |
| `POST` | `/api/v1/organizations/:key/import` | Import that organization's repositories. |
| `POST` | `/api/v1/organizations/import` | Import every enabled organization. |
| `GET` `POST` | `/api/v1/repositories` | List / add a monitored repository. |
| `GET` `PATCH` `DELETE` | `/api/v1/repositories/:idOrUrl` | Inspect / enable-disable / soft-delete. |
| `POST` | `/api/v1/repositories/:idOrUrl/restore` | Undo a soft delete. |
| `GET` | `/api/v1/repositories/:idOrUrl/dependencies` | Parsed dependencies. |
| `GET` `POST` | `/api/v1/repositories/:idOrUrl/technologies` | Languages, topics and ecosystems / re-read languages from the provider. |
| `POST` | `/api/v1/repositories/:idOrUrl/scan` | Scan one repository. |
| `POST` | `/api/v1/repositories/scan-all` | Scan every configured repository. |
| `GET` `POST` | `/api/v1/owners` | List / create owners. |
| `GET` `PATCH` `DELETE` | `/api/v1/owners/:id` | Manage one owner. |
| `POST` | `/api/v1/owners/:id/assignments` | Assign an ecosystem / dependency / repository. |
| `DELETE` | `/api/v1/owners/:id/assignments/:assignmentId` | Remove an assignment. |
| `GET` `POST` | `/api/v1/scan` | Monitoring cycle status / trigger one now. |
| `GET` `PUT` | `/api/v1/settings` | Runtime settings. |
| `GET` | `/api/v1/reports/weekly` | Weekly report payload. |
| `POST` | `/api/v1/slack/actions` | Slack interactive callbacks (signature-verified). |

Full API reference: [Wiki — API Reference](https://github.com/jacksonfdam/atalaia/wiki/API-Reference)

---

## Console

The management console is a **separate service** (`ui/`, port 3001). It talks to the Atalaia API over
HTTP only — it never opens the database and holds no business logic — so it can run on a different
host from the API.

```bash
./scripts/atalaia.sh up
open http://localhost:3001
```

| Page | What it manages |
|------|-----------------|
| Overview | Counts by severity/status/source, open criticals, trigger a monitoring cycle |
| Vulnerabilities | Filter, paginate, acknowledge and resolve |
| Sources | Enable/disable each source, live per-feed health, and the full database catalog |
| Organizations | Register GitHub organizations with their own tokens and import their repositories |
| Repositories | Add, enable/disable, scan, inspect technologies and parsed dependencies |
| Owners | Owners and their ecosystem/dependency/repository assignments |
| Settings | Slack toggle, schedules, LLM provider, email — plus which credentials are configured |

**Authentication.** The browser signs in against the console with `UI_PASSWORD` and receives an
HMAC-signed, HttpOnly session cookie. Requests then go to the console's `/bff` prefix, which
attaches `X-API-Key` server-side. The API key never reaches the browser. Sign-in is throttled to
5 failed attempts per IP, with a 15-minute lockout.

---

## CLI

A terminal client ships with the package — a live dashboard plus scriptable commands. It reads the
SQLite database directly, so it runs wherever the database file is.

```bash
pnpm run build:cli       # compile to dist/ (also runs on `pnpm install`)
node bin/atalaia.js --help
pnpm run dev:cli         # run from source with tsx
```

| Command | Purpose |
|---------|---------|
| `atalaia dashboard` | Live Ink dashboard (default command). `-r, --refresh <seconds>` |
| `atalaia status` | One-shot summary. `--json` |
| `atalaia list` | Query vulnerabilities. `--source`, `--tech`, `--limit`, `--json` |
| `atalaia show <cve-id>` | Details, explanation and timeline. |
| `atalaia ack <cve-id>` | OPEN → ACKNOWLEDGED. `--actor` |
| `atalaia resolve <cve-id>` | → RESOLVED. `--actor` |
| `atalaia scan` | Run a monitoring cycle now. `--dry-run` disarms the Slack webhook. |
| `atalaia repo add\|remove\|list\|scan\|deps` | Monitored repositories. `--all`, `--ecosystem`, … |
| `atalaia owner add\|remove\|list\|show\|assign\|unassign` | Owners and assignments. |

`--db <path>` overrides the database location for any command.

---

## Architecture

Clean Architecture with strict layer boundaries — domain logic has zero external dependencies.

```
src/                  # API service
├── domain/           # Pure business logic
├── application/      # Use cases and orchestration
├── infrastructure/   # External integrations (feeds, DB, Slack, email, LLM)
├── interface/        # HTTP server, REST API, Slack action handler
└── cli/              # Ink terminal client

ui/                   # Console service — no imports from src/
├── server/           # BFF: session auth + API-key-injecting proxy
└── src/              # React client

config/               # Technology filter, vendor mappings, database catalog
db/migrations/        # SQL migrations, applied on startup
scripts/atalaia.sh      # Launcher for both services, Docker or local
```

One source per file under `infrastructure/feeds/`, listed in `feedRegistry.js`
— the single list the monitoring cycle and the health check both read, so a
source can never be collected but invisible to health checks, or the reverse.

Full architecture guide: [Wiki — Architecture](https://github.com/jacksonfdam/atalaia/wiki/Architecture)

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 24 LTS (ES Modules) |
| Package manager | pnpm 11 workspaces (root + `ui`) |
| Framework | Express |
| Database | SQLite (better-sqlite3, WAL mode) |
| Logging | Pino |
| Notifications | Slack Block Kit, nodemailer |
| Intelligence | OpenAI API, Ollama |
| Scraping | axios, cheerio, rss-parser |
| Console | React 19, Vite |
| CLI | Ink, commander, TypeScript |
| Testing | Jest, supertest |
| Deployment | Docker (multi-stage `node:24-alpine`) |

---

## Development

```bash
pnpm install                  # root + ui workspaces
pnpm run dev                  # API with hot-reload
pnpm test                     # Jest suite (ES modules via --experimental-vm-modules)
pnpm run test:watch
pnpm run test:coverage
pnpm --filter atalaia-console run typecheck
./scripts/atalaia.sh doctor     # verify the environment
```

Tests live in `tests/unit/` and `tests/integration/`. HTTP tests mount the app through
`createApp()` with a stub cache, so no port is opened and no feed is fetched.

---

## Troubleshooting

| Symptom | Cause and fix |
|---------|---------------|
| `Refusing to install with npm` | The repo is pnpm-only — the lockfile carries the security overrides. `corepack enable && pnpm install`. |
| `UI_SESSION_SECRET is not set` | The console refuses to start without it. `openssl rand -hex 32`, or run `./scripts/atalaia.sh init`. |
| `Console is misconfigured: API_KEY is not set` | The console process did not get `API_KEY`. Export it or start via the launcher. |
| Console loads but every request 401s | `API_KEY` in the console's environment does not match the API's. |
| Port already in use | Another instance is running: `./scripts/atalaia.sh status`, then `down`. Or change `PORT` / `UI_PORT`. |
| Slack buttons do nothing | `SLACK_SIGNING_SECRET` missing, or Slack cannot reach the callback URL — locally that needs the ngrok tunnel. |
| Feed shows as failing under Sources | Upstream scraping target changed or is rate-limiting. The cycle continues; other feeds are unaffected. Disable it from the Sources page if it stays broken. |
| GHSA returns 403 | Unauthenticated GitHub calls get 60 requests/hour per IP. Set `GITHUB_TOKEN`. |
| `Cannot decrypt the token for "…"` | `TOKEN_ENCRYPTION_KEY` (or `API_KEY`, when it is the fallback) is not the value the token was stored with. Save the token again. |
| `GitHub rejected the token for this organization` | The token expired or cannot see that organization. Replace it on the Organizations page. |
| Docker build is slow the first time | `better-sqlite3` is compiled from source — no musl prebuilds. Later builds are cached. |
| No console bundle in local mode | `pnpm --filter atalaia-console run build`, or `./scripts/atalaia.sh up --local --build`. |

---

## Documentation

All detailed documentation lives in the [GitHub Wiki](https://github.com/jacksonfdam/atalaia/wiki):

- [Home](https://github.com/jacksonfdam/atalaia/wiki) — Overview and getting started
- [Architecture](https://github.com/jacksonfdam/atalaia/wiki/Architecture) — Clean Architecture layers and data flow
- [API Reference](https://github.com/jacksonfdam/atalaia/wiki/API-Reference) — Full REST API documentation
- [Configuration](https://github.com/jacksonfdam/atalaia/wiki/Configuration) — Environment variables and feed setup
- [Deployment](https://github.com/jacksonfdam/atalaia/wiki/Deployment) — Docker, production checklist, troubleshooting
- [Compliance](https://github.com/jacksonfdam/atalaia/wiki/ISO-27001-Compliance) — ISO 27001 alignment strategy

---

## Roadmap

Track progress on the [Project Board](https://github.com/jacksonfdam/atalaia) and [Issues](https://github.com/jacksonfdam/atalaia/issues).

---

## Credits

**Created by [Jackson Mafra](https://github.com/jacksonfdam)** — Mobile and Security Engineer at [jacksonfdam](https://github.com/jacksonfdam)

Built from the ground up starting September 2025. 
From initial concept through architecture design, feed integration, Slack workflows, email reporting, and LLM-powered intelligence, a solo effort to give engineering teams the vulnerability visibility they deserve.

---

## License

MIT — see LICENSE.
