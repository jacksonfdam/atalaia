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
# Server runs on http://localhost:3000 (or custom PORT env var)
curl http://localhost:3000/health
```

## Local Development

```bash
npm install
cp .env.example .env
# Edit .env (configure HOST and PORT)
npm run dev    # Hot-reload with nodemon
```

**Access the server:**
- Locally: `http://localhost:3000`
- Other local IP: `http://192.168.1.100:3000` (set `HOST=0.0.0.0` in `.env`)
- Via ngrok: `https://your-ngrok-domain.ngrok.io` (set `HOST=0.0.0.0` in `.env`)

**Environment Examples:**
```bash
# Local development only
HOST=localhost
PORT=3000

# Accept external connections (Docker, ngrok, local IP)
HOST=0.0.0.0
PORT=3000

# Specific local IP (useful for LAN access)
HOST=192.168.1.100
PORT=3000
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

### Base URL
```
http://localhost:3000  (or http://localhost:PORT if PORT env var is set)
```

### Authentication
All endpoints under `/api/v1` require `X-API-Key` header with a valid API key. The `/health` endpoint does not require authentication. The `/api/v1/slack/actions` endpoint requires Slack request signature verification instead.

### Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| **GET** | `/health` | None | Health check - returns `{"status":"ok","timestamp":"..."}` |
| **GET** | `/api/v1/vulnerabilities` | API Key | List vulnerabilities with optional filters |
| **PATCH** | `/api/v1/vulnerabilities/:cveId/status` | API Key | Update vulnerability status to ACKNOWLEDGED or RESOLVED |
| **GET** | `/api/v1/stats` | API Key | Get vulnerability statistics (counts by status/severity/source) |
| **POST** | `/api/v1/query` | API Key | Query vulnerabilities by technology stack |
| **GET** | `/api/v1/technologies` | API Key | View active technology filters |
| **POST** | `/api/v1/technologies` | API Key | Update technology filters |
| **POST** | `/api/v1/slack/actions` | Slack Sig | Slack interactive action handler (acknowledge/resolve buttons) |

### Examples

```bash
# Health check (no auth required)
curl http://localhost:3000/health
# Response: {"status":"ok","timestamp":"2026-03-09T..."}

# List all vulnerabilities
curl -H "X-API-Key: your-api-key-here" \
  "http://localhost:3000/api/v1/vulnerabilities"

# List only CRITICAL vulnerabilities
curl -H "X-API-Key: $API_KEY" \
  "http://localhost:3000/api/v1/vulnerabilities?severity=CRITICAL"

# List vulnerabilities by status
curl -H "X-API-Key: $API_KEY" \
  "http://localhost:3000/api/v1/vulnerabilities?status=OPEN"

# Get vulnerability statistics
curl -H "X-API-Key: $API_KEY" \
  "http://localhost:3000/api/v1/stats"

# Acknowledge a vulnerability
curl -X PATCH -H "X-API-Key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"status":"ACKNOWLEDGED","changedBy":"security-team"}' \
  http://localhost:3000/api/v1/vulnerabilities/CVE-2024-0001/status

# Resolve a vulnerability
curl -X PATCH -H "X-API-Key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"status":"RESOLVED","changedBy":"security-team"}' \
  http://localhost:3000/api/v1/vulnerabilities/CVE-2024-0001/status

# Query vulnerabilities by technology
curl -X POST -H "X-API-Key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"technologies":["react","node.js","docker"]}' \
  http://localhost:3000/api/v1/query

# View active technology filters
curl -H "X-API-Key: $API_KEY" \
  "http://localhost:3000/api/v1/technologies"

# Update technology filters
curl -X POST -H "X-API-Key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"technologies":["react","node.js","kubernetes"]}' \
  http://localhost:3000/api/v1/technologies
```

## Configuration

### Environment Variables

See `.env.example` for all options. Key variables:

| Variable | Required | Type | Default | Description |
|----------|----------|------|---------|-------------|
| `HOST` | No | string | `0.0.0.0` | Hostname/IP to bind to (`0.0.0.0` = all interfaces, `localhost` = local only) |
| `PORT` | No | number | `3000` | HTTP server port |
| `SLACK_WEBHOOK_URL` | Yes | string | — | Slack incoming webhook URL for notifications |
| `API_KEY` | Yes | string | — | API authentication key (used in `X-API-Key` header) |
| `SLACK_SIGNING_SECRET` | No | string | — | Secret for Slack request signature verification (for interactive buttons) |
| `EMAIL_SERVICE` | No | enum | `smtp` | Email service: `smtp` \| `mailtrap` \| `sendgrid` |
| `SMTP_HOST` | No | string | — | SMTP server host (if using smtp) |
| `SMTP_PORT` | No | number | — | SMTP server port (if using smtp) |
| `SMTP_USER` | No | string | — | SMTP username (if using smtp) |
| `SMTP_PASS` | No | string | — | SMTP password (if using smtp) |
| `SENDGRID_API_KEY` | No | string | — | SendGrid API key (if using sendgrid) |
| `DB_PATH` | No | string | `data/atalaia.db` | SQLite database file path |
| `NODE_ENV` | No | enum | `development` | Environment: `development` \| `production` |
| `CRON_SCHEDULE` | No | cron | `*/30 * * * *` | Feed monitoring interval (cron format) |
| `WEEKLY_REPORT_CRON` | No | cron | `0 9 * * 1` | Weekly report schedule (default: Monday 9 AM) |
| `LLM_PROVIDER` | No | enum | (empty) | LLM provider: `openai` \| `ollama` (empty = disabled) |
| `OPENAI_API_KEY` | No | string | — | OpenAI API key (if using openai) |
| `OLLAMA_BASE_URL` | No | string | `http://localhost:11434` | Ollama API endpoint |
| `LOG_LEVEL` | No | enum | `info` | Pino log level: `debug` \| `info` \| `warn` \| `error` |
| `CORS_ORIGINS` | No | string | `http://localhost:3000` | Comma-separated CORS allowed origins |

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

### Quick Commands

```bash
docker compose up -d           # Start service in background
docker compose logs -f         # View logs (live)
docker compose down            # Stop service
curl http://localhost:3000/health  # Verify health
```

### Port Configuration

- **Default port:** 3000 (mapped in `docker-compose.yml` as `3000:3000`)
- **Custom port:** Update `.env` with `PORT=8000` and restart container
- **Docker port mapping:** Edit `docker-compose.yml` ports section if needed

### Volumes

- Database persists in `./data/atalaia.db` (mounted at `/app/data`)
- Logs are printed to stdout (view with `docker compose logs`)

### Health Checks

The container includes automatic health checks:
- **Endpoint:** `GET /health`
- **Interval:** Every 30 seconds
- **Timeout:** 5 seconds per check
- **Retries:** 3 failures before unhealthy
- **Startup wait:** 10 seconds before first check

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
