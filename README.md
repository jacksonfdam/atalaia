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

Delivery is normally configured from the console (**Settings → EMAIL.CFG**), which stores the
provider and its credential in the database. These variables still work and **take precedence** —
set `SMTP_HOST` and the console section turns read-only, so a deployment that pins credentials in
the environment keeps behaving exactly as before.

| Variable | Default | Description |
|----------|---------|-------------|
| `SMTP_HOST` | — | SMTP server. Setting it pins the whole email configuration to the environment. |
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

## What Atalaia does not do

Atalaia reports. Every team keeps ownership of its own upgrades, and of whether an upgrade is
compatible with the rest of what it ships.

- **It never writes to GitHub.** No pull requests, no branches, no commits, no issues, no status
  checks. Every request in the provider goes through one GET helper, and a test fails the build if a
  write call appears in that file.
- **It never changes a manifest.** Nothing bumps a version, edits a lockfile or opens an upgrade.
- **It does not judge compatibility.** "Behind by a major" means the registry has a newer release
  than the manifest allows — not that upgrading is safe, wanted, or anyone's priority. Whether that
  major breaks you is a question about your code, and your code is where it gets answered.
- **It does not gate anything.** There is no build to fail and no threshold to enforce.

What it does instead: watch the public sources, work out which of your repositories a finding
actually reaches, and tell the right people through Slack, email or the console.

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

**One repository at a time.** Clicking a repository's name opens its own page — exposure,
dependencies and technologies as tabs, each panel loading independently so nothing blocks the rest.
The ↗ next to the name leaves for GitHub. Table headers sort: click one to sort by it, click it
again to flip the direction.

**Are we behind?** The Dependencies tab shows the declared version next to the **latest published
one**, asked of each ecosystem's own registry — npm, PyPI, crates.io, RubyGems, Packagist, NuGet,
the Go module proxy, Maven Central, and GitHub releases for actions. The lookups run detached, a
few at a time, and each row is written the moment its own answer arrives, so the table fills in
while you watch and an interrupted check keeps everything it already resolved. Answers are cached
for a day; **Re-check all** ignores the cache. Docker, Terraform and Helm are listed as not
checkable — their versions depend on which registry the artifact came from.

Manifests do not declare versions, they declare *constraints* — `^4.17.0`, `~> 6.1`, `==2.28.0`,
`v3`, a commit SHA — so each one is translated into a semver range and asked whether it already
allows the newest release. `^5.0.0` against 5.2.1 is **current**; `^4.17.1` against it is **behind**
by a major. Anything untranslatable — a digest pin, a Maven interval — answers *unknown* with the
reason rather than guessing, because a false "up to date" is worse than an admitted gap. Each row
shows how far behind it is: major, minor or patch.

Dependencies are **grouped by ecosystem**, since one repository routinely carries several: an
Android project shows Gradle, GitHub Actions, its Fastlane gems and npm as separate tables, each
with its own counts.

**Finding one among many.** `GET /api/v1/repositories` takes `search`, `org`, `language`,
`enabled`, `archived` and `exposure` (`affected` / `exploited` / `clean`), sorts by `name`,
`exposure`, `last_scanned_at`, `primary_language`, `org_key` or `updated_at` in either direction,
and pages with `limit` (25 by default, 200 at most) and `offset`. The response carries the totals
behind the page and the values the console needs for its filter menus. The console exposes all of
it in the toolbar above the table.

**Personal accounts.** A token only ever exposes the private repositories of *its own* account, so
registering someone else's login lists their public repositories and nothing more. The picker says
so when that happens instead of quietly showing a short list.

**Importing a subset.** "Choose repos" lists everything the token can see — with a filter, and each
row marked *new*, *tracked* or *removed here* — and imports only what is ticked. Whole-organization
import stays one click away. From the terminal that is `atalaia org repos <key>` to list and
`atalaia org import <key> --only org/a,org/b` to pick.

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
| `GET` | `/api/v1/organizations/:key/repositories` | What the token can see, annotated with what is already tracked. Reads only. |
| `POST` | `/api/v1/organizations/:key/import` | Import that organization's repositories, or a subset via `{"repositories":["org/a"]}`. |
| `POST` | `/api/v1/organizations/import` | Import every enabled organization. |
| `GET` `POST` | `/api/v1/repositories` | List (filtered, sorted, paginated) / add a monitored repository. |
| `GET` `PATCH` `DELETE` | `/api/v1/repositories/:idOrUrl` | Inspect / enable-disable / soft-delete. |
| `POST` | `/api/v1/repositories/:idOrUrl/restore` | Undo a soft delete. |
| `GET` | `/api/v1/repositories/:idOrUrl/dependencies` | Parsed dependencies, with the latest published version of each. |
| `GET` `POST` | `/api/v1/repositories/:idOrUrl/versions` | Progress of the freshness check / start one (202, runs detached). |
| `GET` | `/api/v1/repositories/:idOrUrl/vulnerabilities` | Which CVEs reach this repository, and through which dependency. |
| `GET` `POST` | `/api/v1/repositories/:idOrUrl/technologies` | Languages, topics and ecosystems / re-read languages from the provider. |
| `POST` | `/api/v1/repositories/:idOrUrl/scan` | Scan one repository. |
| `GET` `POST` | `/api/v1/repositories/scan-all` | Progress of the fleet scan / start one (202, runs detached). |
| `GET` `POST` | `/api/v1/owners` | List / create owners. |
| `GET` `PATCH` `DELETE` | `/api/v1/owners/:id` | Manage one owner. |
| `POST` | `/api/v1/owners/:id/assignments` | Assign an ecosystem / dependency / repository. |
| `DELETE` | `/api/v1/owners/:id/assignments/:assignmentId` | Remove an assignment. |
| `GET` `POST` | `/api/v1/scan` | Monitoring cycle status / trigger one now. |
| `GET` `PUT` | `/api/v1/settings` | Runtime settings. |
| `GET` `PUT` | `/api/v1/settings/email` | Email provider catalog and delivery configuration. |
| `GET` `PUT` | `/api/v1/settings/slack` | Slack integration: webhook or bot token, and the destination. |
| `POST` | `/api/v1/settings/slack/test` | Post a test message to the configured destination. |
| `POST` | `/api/v1/settings/email/test` | Verify the SMTP connection, or `{"send":true}` to deliver a test digest. |
| `GET` | `/api/v1/reports/weekly` | Weekly report payload. |
| `POST` | `/api/v1/slack/actions` | Slack interactive callbacks (signature-verified). |

Full API reference: [Wiki — API Reference](https://github.com/jacksonfdam/atalaia/wiki/API-Reference)

---

## When a vulnerability reaches a repository

A CVE only matters here if it lands in something you ship, so Atalaia answers that in both
directions:

- **The alert says so.** The Slack message lists the affected repositories and the owners
  responsible, alongside the CVE itself.
- **The repository says so.** Repositories carry an **Exposure** column — worst severity, how many
  open CVEs, and a 🚨 when one of them is known-exploited. Expanding a row lists each CVE with the
  dependency and the manifest file it arrives through, which is the file you actually have to open.
- **The overview says so.** `EXPOSED_REPOS.LST` ranks the repositories carrying the most open CVEs.
- **The CVE says so.** A vulnerability's detail page lists the repositories it touches.

The link is computed, never stored: dependencies change with every scan and a CVE's technology
list can be enriched after the fact, so a stored join would go quietly stale.

Coverage depends on a scan having run — `Scan all`, or the nightly schedule
(`repositories.autoScan`). A fleet scan walks repositories **one at a time**, which keeps the
GitHub rate limit and the log readable but takes roughly ten seconds per repository, so it runs
detached from the request that started it: `POST` answers `202` immediately, a second trigger gets
`409`, and `GET /api/v1/repositories/scan-all` reports how many are done, which one is being
scanned right now, and what failed. The console polls it and shows the same line. Passing
`{"skipVendorLookup": true}` drops the per-dependency OpenCVE lookup, which is most of the time. Manifests parsed include npm, pip, Go, Cargo, Maven, Gradle, RubyGems,
NuGet, Composer, Terraform, Dockerfiles and **GitHub Actions workflows** — CI pulls third-party
actions and container images by tag, and a tag nobody upgrades on purpose is exactly where an old
vulnerable dependency hides.

---

## Slack alerts

Configure delivery under **Notifications → SLACK.CFG**. Two integrations, because they can do
different things:

| Mode | What it can do | What it needs |
|------|----------------|---------------|
| Incoming webhook | Posts to the one channel the webhook was created for. Slack ignores any other destination. | The `https://hooks.slack.com/services/…` URL |
| Bot token | Posts to any channel the bot is in, and can direct-message a person | `xoxb-…` with `chat:write` (plus `chat:write.public` for public channels it has not joined) |

In bot mode the destination is a channel (`#security` or its `C…` ID) or a person (their `U…`
member ID, which opens a direct message). Turning on **direct-message the owners** additionally
DMs whoever the vulnerability correlates to, using the Slack member ID on each owner — owners
without one are skipped, and a webhook cannot do this at all.

The whole Slack app fits in that one section — webhook URL or bot token, signing secret, app-level
token and app ID. Credentials are encrypted at rest and never returned by the API. **Send test**
posts a real message so you can confirm the destination before the next cycle.

| Field | What it is for |
|-------|----------------|
| Webhook URL / bot token | Sending the alert |
| Signing secret | Verifying the Acknowledge and Resolve clicks Slack sends back |
| App-level token + app ID | Development only: repointing the app's Request URL at the current ngrok tunnel |

Alerts carry the affected repositories and owners when correlation finds any.

Environment variables still win, field by field: `SLACK_WEBHOOK_URL` pins where alerts go,
`SLACK_SIGNING_SECRET`, `SLACK_APP_TOKEN` and `SLACK_APP_ID` pin their own fields, and
`SLACK_ENABLED=false` forces delivery off wherever it is configured. A pinned field is shown as
read-only rather than silently ignored.

### Desktop notifications

**Notifications → DESKTOP.CFG** is the fallback for when Slack is not delivering. Allow
notifications once and the console raises a native pop-up per new CVE — clicking one opens it.

It needs the console open in a tab, since a closed tab runs no code; for alerts that arrive with
the browser shut, use Slack or the weekly email.

---

## Weekly email report

Every Monday at 09:00 (`WEEKLY_REPORT_CRON`) Atalaia emails a digest of **what it detected in the last
seven days**, with the running total of everything still open shown alongside it. A quiet week reads
as "nothing new, 113 open" instead of re-sending the whole backlog. Unrated findings — Ubuntu USN
and the CERT feeds publish no CVSS — get their own bucket rather than being dropped.

Pick a provider under **Settings → EMAIL.CFG**, fill in its credential, and save:

| Provider | What it asks for |
|----------|------------------|
| Mailtrap | Host (sandbox or live), port, username, password |
| Mailjet | API key (as the username) and secret key |
| SendGrid | API key — the username is the literal string `apikey` |
| Mailgun | SMTP host (US or EU), SMTP login, password |
| MailerLite | Username and password |
| Resend | API key — the username is the literal string `resend` |
| Custom SMTP | Host, port, username, password |

All of them are reached over SMTP through nodemailer rather than six REST SDKs: every provider here
offers SMTP with the same credentials its API uses, and one transport means one code path to keep
working.

The credential is encrypted at rest with `TOKEN_ENCRYPTION_KEY` (or `API_KEY`) and never returned by
the API — the console shows only its last four characters. Two buttons check the setup without
waiting for Monday: **Test connection** opens the SMTP session and authenticates without sending,
and **Send test** delivers the current digest to the configured recipients.

```bash
curl -H "X-API-Key: $API_KEY" http://localhost:3000/api/v1/settings/email

curl -X PUT -H "X-API-Key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"provider":"resend","secret":"re_…","from":"atalaia@example.com",
       "recipients":"security@example.com","enabled":true}' \
  http://localhost:3000/api/v1/settings/email

curl -X POST -H "X-API-Key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"send":false}' http://localhost:3000/api/v1/settings/email/test
```

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
| Notifications | Slack integration (webhook or bot, channel or person), plus owners and their ecosystem/dependency/repository assignments |
| Settings | Slack toggle, schedules, LLM provider, email provider and credentials, plus which secrets are configured |

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
| `atalaia feed list\|enable\|disable\|reset\|catalog` | Sources and the database catalog. `--all`, `--json` |
| `atalaia org add\|list\|repos\|import\|enable\|disable\|token\|remove` | Organizations and their read-only tokens. `--token`, `--only`, `--no-languages` |
| `atalaia repo add\|remove\|restore\|enable\|disable\|list\|scan\|deps\|tech` | Monitored repositories. `--all`, `--ecosystem`, `--refresh`, … |
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
