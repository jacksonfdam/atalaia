# Atalaia

Real-time security vulnerability monitoring service. Fetches CVEs from multiple feeds, filters by technology stack, sends Slack alerts with interactive buttons, and provides a REST API for vulnerability management.

## Features

- **Multi-source feeds** — CISA, Snyk, VulDB, CVE Details, NVD
- **Technology filtering** — Only alert on vulns matching your stack
- **Slack notifications** — Block Kit messages with Acknowledge/Resolve buttons
- **Status lifecycle** — OPEN / ACKNOWLEDGED / RESOLVED tracking
- **LLM explanations** — Plain-English CVE summaries via OpenAI or Ollama
- **Weekly email reports** — Grouped by severity, sent via SMTP
- **REST API** — Query, filter, and manage vulnerabilities programmatically
- **SQLite persistence** — WAL mode for concurrent reads

## Quick Start (Docker Compose)

```bash
cp .env.example .env
# Edit .env with your Slack webhook URL and API key
docker compose up -d
curl http://localhost:3000/health
```

## Local Development

```bash
npm install
cp .env.example .env
# Edit .env
npm run dev    # Hot-reload with nodemon
```

## Architecture

Clean Architecture with four layers:

```
src/
  domain/           # Pure business logic (zero external imports)
    entities/       #   Vulnerability class
    enums/          #   Status, Severity enums
    ports/          #   Interface contracts
  application/      # Use cases
    monitorVulns.js #   Main monitoring orchestrator
    acknowledgeVuln.js
    resolveVuln.js
    queryByTech.js
    generateWeeklyReport.js
  infrastructure/   # External integrations
    feeds/          #   Individual feed scrapers
    cache/          #   SQLite persistence (better-sqlite3)
    notifiers/      #   Email notifier
    llm/            #   LLM adapter (OpenAI, Ollama)
    notifySlack.js  #   Slack webhook + Block Kit
    scheduler.js    #   Cron jobs
    config.js       #   Configuration loader
    logger.js       #   Pino structured logging
  interface/        # Entry points
    index.js        #   Express server (composition root)
    http/           #   REST API routes
    slack/          #   Slack action handler
```

## API Reference

All endpoints under `/api/v1` require `X-API-Key` header (except where noted).

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/health` | No | Health check |
| GET | `/api/v1/vulnerabilities` | Yes | List vulns (query: `status`, `severity`, `source`) |
| PATCH | `/api/v1/vulnerabilities/:cveId/status` | Yes | Update status (`{ status, changedBy }`) |
| GET | `/api/v1/stats` | Yes | Vulnerability counts by status/severity/source |
| POST | `/api/v1/query` | Yes | Query by technology (`{ technologies: [...] }`) |
| GET | `/api/v1/technologies` | Yes | View active technology filters |
| POST | `/api/v1/technologies` | Yes | Update filters (`{ technologies: [...] }`) |

### Examples

```bash
# List all CRITICAL vulnerabilities
curl -H "X-API-Key: $API_KEY" \
  "http://localhost:3000/api/v1/vulnerabilities?severity=CRITICAL"

# Acknowledge a vulnerability
curl -X PATCH -H "X-API-Key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"status":"ACKNOWLEDGED","changedBy":"security-team"}' \
  http://localhost:3000/api/v1/vulnerabilities/CVE-2024-0001/status

# Query by technology
curl -X POST -H "X-API-Key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"technologies":["react","node.js"]}' \
  http://localhost:3000/api/v1/query
```

## Configuration

### Environment Variables

See `.env.example` for all options. Key variables:

| Variable | Required | Description |
|----------|----------|-------------|
| `SLACK_WEBHOOK_URL` | Yes | Slack incoming webhook |
| `API_KEY` | Yes | API authentication key |
| `DB_PATH` | No | SQLite path (default: `data/atalaia.db`) |
| `CRON_SCHEDULE` | No | Monitoring interval (default: `0 * * * *`) |
| `LLM_PROVIDER` | No | `openai` or `ollama` (empty = disabled) |

### Technology Filters

Edit `config/technologies.json` or use the API:

```bash
curl -X POST -H "X-API-Key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"technologies":["react","docker","kubernetes"]}' \
  http://localhost:3000/api/v1/technologies
```

### Adding an LLM Provider

Set `LLM_PROVIDER=openai` and `OPENAI_API_KEY` in `.env`, or use `LLM_PROVIDER=ollama` with a local Ollama instance. Leave `LLM_PROVIDER` empty to disable explanations.

## Testing

```bash
npm test              # Run all tests
npm run test:coverage # With coverage report
```

## Docker

```bash
docker compose up -d           # Start
docker compose logs -f         # View logs
docker compose down            # Stop
curl http://localhost:3000/health  # Verify
```

Data persists in `./data/` via volume mount.

## Tech Stack

- **Runtime**: Node.js 20 (ES Modules)
- **Framework**: Express
- **Database**: SQLite (better-sqlite3, WAL mode)
- **Logging**: Pino
- **Scheduling**: node-cron
- **Notifications**: Slack (Block Kit), Email (nodemailer)
- **LLM**: OpenAI API, Ollama
- **Scraping**: axios, cheerio, rss-parser
- **Testing**: Jest, supertest
- **Deployment**: Docker (multi-stage Alpine build)
