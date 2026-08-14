# Architecture

Clean Architecture with strict layer boundaries — domain logic has zero external dependencies.

```
src/                  # API service
├── domain/           # Entities, enums and ports — no external imports
├── application/      # Use cases and orchestration
├── infrastructure/   # External integrations (feeds, DB, Slack, Teams, email, LLM, parsers)
├── interface/        # HTTP server, REST API, Slack action handler
└── cli/              # Ink terminal client (TypeScript)

ui/                   # Console service — no imports from src/
├── server/           # BFF: session auth + API-key-injecting proxy
└── src/              # React client

config/               # Technology filter, vendor mappings, database catalog
db/migrations/        # SQL migrations, applied on startup
scripts/atalaia.sh    # Launcher for both services, Docker or local
```

One source per file under `infrastructure/feeds/`, listed in `feedRegistry.js` — the single list the monitoring cycle and the health check both read, so a source can never be collected but invisible to health checks, or the reverse. The same pattern holds for dependency parsers (`infrastructure/parsers/parserRegistry.js`), LLM providers (`infrastructure/llm/llmProviders.js`) and email providers (`infrastructure/notifiers/emailProviders.js`).

## How it works

```
┌─────────────┐     ┌──────────────┐     ┌────────────┐     ┌───────────┐
│  CVE Feeds  │────▶│  Filter by   │────▶│Deduplicate │────▶│  Notify   │
│  (enabled   │     │  Tech Stack  │     │  & Merge   │     │  Slack +  │
│   sources)  │     │              │     │  (SQLite)  │     │  Email    │
└─────────────┘     └──────────────┘     └────────────┘     └───────────┘
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
4. **Deduplication** checks the SQLite cache; merges multi-source CVEs using priority ranking
5. **Notification** sends Slack/Teams alerts with interactive buttons + optional LLM explanation
6. **Weekly digest** emails a severity-grouped report to stakeholders

A first cycle also runs immediately at startup, so a fresh install has data within a minute.

Vulnerability identity is `cve_id` (unique key in SQLite). Status lifecycle is `OPEN → ACKNOWLEDGED → RESOLVED`, changed from Slack buttons, the API, the console or the CLI.

## Tech stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 24 LTS (ES Modules) |
| Package manager | pnpm 11 workspaces (root + `ui`) |
| Framework | Express 5 |
| Database | SQLite (better-sqlite3, WAL mode) |
| Logging | Pino |
| Notifications | Slack Block Kit, Teams Adaptive Cards, nodemailer |
| Intelligence | OpenAI-compatible providers, Anthropic, Ollama |
| Scraping | axios, cheerio, rss-parser |
| Console | React 19, Vite |
| CLI | Ink, commander, TypeScript |
| Testing | Jest, supertest |
| Deployment | Docker (multi-stage `node:24-alpine`) |

## Development

```bash
pnpm install                  # root + ui workspaces
pnpm run dev                  # API with hot-reload
pnpm test                     # Jest suite (ES modules via --experimental-vm-modules)
pnpm run test:watch
pnpm run test:coverage
pnpm --filter atalaia-console run typecheck
./scripts/atalaia.sh doctor   # verify the environment
```

Tests live in `tests/unit/` and `tests/integration/`. HTTP tests mount the app through `createApp()` with a stub cache, so no port is opened and no feed is fetched.

Full architecture guide: [Wiki — Architecture](https://github.com/jacksonfdam/atalaia/wiki/Architecture)
