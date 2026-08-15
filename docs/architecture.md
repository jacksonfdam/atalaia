# Architecture

Clean Architecture with strict layer boundaries — domain logic has zero external dependencies.

```
src/
├── domain/           # Entities, enums and ports — no external imports
├── application/      # Use cases and orchestration
├── infrastructure/   # External integrations
│   ├── db/           # The Postgres pool and the migration runner
│   ├── queue/        # pg-boss: queues, workers, schedules
│   ├── cache/        # Vulnerability, repository and organization persistence
│   ├── feeds/        # One file per source, listed in feedRegistry.js
│   ├── parsers/      # One file per ecosystem, listed in parserRegistry.js
│   ├── notifiers/    # Slack, Teams, email
│   └── llm/          # Provider catalog and adapters
├── interface/
│   ├── index.js      # The API: HTTP server, REST routes, Slack callbacks
│   ├── worker.js     # The worker: no port, takes jobs off the queue
│   ├── http/         # Routes, one file per resource
│   └── mcp/          # MCP tools for agents, served at /mcp by the API
└── cli/              # Ink terminal client (TypeScript), an HTTP client

ui/                   # Console service — no imports from src/
├── server/           # BFF: session auth + API-key-injecting proxy
└── src/              # React client

docs/                 # This documentation, and the site built from it
└── site/             # The renderer: Markdown in, static HTML out

config/               # Technology filter, vendor mappings, database catalog
db/migrations/        # SQL migrations, applied on boot behind an advisory lock
supabase/             # Local Supabase stack definition (development)
scripts/atalaia.sh    # Launcher: Docker Compose or Apple container
```

**Three processes, one database.** The API serves requests and enqueues work. The
worker runs it. The console talks only to the API. Postgres (Supabase) holds the
data, the queue and the schedules — which is what makes "is a scan running?" a
question with one answer no matter how many containers are up.

One source per file under `infrastructure/feeds/`, listed in `feedRegistry.js` — the single list the monitoring cycle and the health check both read, so a source can never be collected but invisible to health checks, or the reverse. The same pattern holds for dependency parsers (`infrastructure/parsers/parserRegistry.js`), LLM providers (`infrastructure/llm/llmProviders.js`) and email providers (`infrastructure/notifiers/emailProviders.js`).

## How it works

```
┌─────────────┐     ┌──────────────┐     ┌────────────┐     ┌───────────┐
│  CVE Feeds  │────▶│  Filter by   │────▶│Deduplicate │────▶│  Notify   │
│  (enabled   │     │  Tech Stack  │     │  & Merge   │     │  Slack +  │
│   sources)  │     │              │     │ (Postgres) │     │  Email    │
└─────────────┘     └──────────────┘     └────────────┘     └───────────┘
     NVD                 config/              Source           Block Kit
     CISA KEV            technologies.json    priority         buttons
     MITRE / EUVD                             ranking          + weekly
     GHSA / OpenCVE                                            reports
     Snyk / VulDB
     …and the rest,
     off by default
```

1. **A schedule fires** — a cron row in the database, so exactly one job is created however many services are running
2. **The worker takes the job** and fetches all enabled sources concurrently — one feed failure never blocks others
3. **Tech filter** matches CVEs against your stack (case-insensitive, configurable at runtime)
4. **Deduplication** checks what is already stored; merges multi-source CVEs using source priority
5. **Notification** sends Slack/Teams alerts with interactive buttons + optional LLM explanation
6. **Weekly digest** emails a severity-grouped report to stakeholders

Nothing runs at API startup any more: a cycle happens when a schedule fires or
someone asks for one. See [queues.md](queues.md).

Vulnerability identity is `cve_id` (a unique key). Status lifecycle is
`OPEN → ACKNOWLEDGED → RESOLVED`, changed from Slack buttons, the API, the
console or the CLI.

## Tech stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 24 LTS (ES Modules) |
| Database | Postgres, via Supabase (local stack in development, cloud project in production) |
| Queue | pg-boss, in the same Postgres — no Redis |
| Package manager | pnpm 11 workspaces (root + `ui`) |
| Framework | Express 5 |
| Logging | Pino |
| Notifications | Slack Block Kit, Teams Adaptive Cards, nodemailer |
| Intelligence | OpenAI-compatible providers, Anthropic, Ollama |
| Scraping | axios, cheerio, rss-parser |
| Console | React 19, Vite |
| CLI | Ink, commander, TypeScript — an HTTP client of the API |
| Testing | Jest, supertest |
| Deployment | Containers only: Docker Compose or Apple container |

## Development

```bash
pnpm install                  # root + ui workspaces
supabase start                # the local database

pnpm run dev                  # API with hot-reload
pnpm run dev:worker           # worker with hot-reload
TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54622/postgres pnpm test
pnpm --filter atalaia-console run typecheck
./scripts/atalaia.sh doctor   # runtime, database and configuration
```

Tests live in `tests/unit/` and `tests/integration/`. Each integration suite takes
its own Postgres schema — and its own pg-boss schema — through `search_path`, so
suites cannot see each other's rows and none of them can see a developer's
running worker. Without `TEST_DATABASE_URL` they skip themselves and say why, so
the unit suites still run anywhere.
