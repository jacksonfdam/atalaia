# Atalaia

**Proactive vulnerability intelligence for engineering teams.**

Atalaia is an automated security monitoring service that aggregates CVE data from multiple authoritative sources, filters it against your technology stack, and delivers actionable alerts — so your team can respond to threats before they become incidents.

Built for teams that ship fast and need security to keep up.

---

## Why Atalaia?

Most vulnerability scanners are reactive — they tell you what's wrong *after* the fact. Atalaia continuously monitors public feeds and notifies your team the moment a relevant CVE is published, with severity context, exploit status, and one-click triage.

- **6 intelligence sources** in a single pipeline — CISA KEV, NVD, Snyk, VulDB, CVE Details, OpenCVE
- **Stack-aware filtering** — only see vulnerabilities that affect *your* technologies
- **Slack-native workflow** — Block Kit alerts with Acknowledge/Resolve buttons, no context-switching
- **Weekly executive reports** — severity-grouped HTML emails for stakeholders
- **Zero-config deduplication** — same CVE from multiple sources? Merged automatically with source priority
- **LLM-powered summaries** — plain-English explanations via OpenAI or local Ollama

---

## Quick Start

```bash
# Clone and configure
git clone https://github.com/jacksonfdam/atalaia.git
cd atalaia
cp .env.example .env    # Add your Slack webhook URL and API key

# Run with Docker
docker compose up -d

# Or run locally
npm install
npm run dev
```

Verify it's running:
```bash
curl http://localhost:3000/health
# → {"status":"ok","timestamp":"..."}
```

---

## How It Works

```
┌─────────────┐     ┌──────────────┐     ┌───────────┐     ┌───────────┐
│  CVE Feeds  │────▶│  Filter by   │────▶│ Deduplicate│────▶│  Notify   │
│  (6 sources)│     │  Tech Stack  │     │  & Merge   │     │  Slack +  │
│             │     │              │     │  (SQLite)  │     │  Email    │
└─────────────┘     └──────────────┘     └───────────┘     └───────────┘
     CISA KEV            config/              Source           Block Kit
     NVD                 technologies.json    priority         buttons
     Snyk                                    ranking          + weekly
     VulDB                                                    reports
     CVE Details
     OpenCVE
```

1. **Scheduler** triggers monitoring on a configurable cron interval (default: every 30 min)
2. **Feed aggregator** fetches all sources concurrently — one feed failure never blocks others
3. **Tech filter** matches CVEs against your stack (case-insensitive, configurable at runtime)
4. **Deduplication** checks SQLite cache; merges multi-source CVEs using priority ranking
5. **Notification** sends Slack alerts with interactive buttons + optional LLM explanation
6. **Weekly digest** emails a severity-grouped report to stakeholders

---

## Configuration

All configuration is done through environment variables. See [`.env.example`](.env.example) for the full list.

| Variable | Required | Description |
|----------|----------|-------------|
| `SLACK_WEBHOOK_URL` | Yes | Slack incoming webhook for alerts |
| `API_KEY` | Yes | Authentication key for the REST API |
| `PORT` | No | Server port (default: `3000`) |
| `CRON_SCHEDULE` | No | Monitoring interval (default: `*/30 * * * *`) |
| `LLM_PROVIDER` | No | `openai` or `ollama` for CVE summaries |
| `EMAIL_TEMPLATE` | No | `professional` or `minimal` for weekly reports |

Full documentation: [GitHub Wiki](https://github.com/jacksonfdam/atalaia/wiki)

---

## REST API

Atalaia exposes a REST API for programmatic access to vulnerability data.

```bash
# List all vulnerabilities
curl -H "X-API-Key: $API_KEY" http://localhost:3000/api/v1/vulnerabilities

# Filter by severity
curl -H "X-API-Key: $API_KEY" "http://localhost:3000/api/v1/vulnerabilities?severity=CRITICAL"

# Get statistics
curl -H "X-API-Key: $API_KEY" http://localhost:3000/api/v1/stats

# Acknowledge a CVE
curl -X PATCH -H "X-API-Key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"status":"ACKNOWLEDGED","changedBy":"security-team"}' \
  http://localhost:3000/api/v1/vulnerabilities/CVE-2024-0001/status
```

Full API reference: [Wiki — API Reference](https://github.com/jacksonfdam/atalaia/wiki/API-Reference)

---

## Architecture

Clean Architecture with strict layer boundaries — domain logic has zero external dependencies.

```
src/
├── domain/           # Pure business logic
├── application/      # Use cases and orchestration
├── infrastructure/   # External integrations (feeds, DB, Slack, email, LLM)
└── interface/        # HTTP server, REST API, Slack action handler
```

Full architecture guide: [Wiki — Architecture](https://github.com/jacksonfdam/atalaia/wiki/Architecture)

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 24 LTS (ES Modules) |
| Framework | Express |
| Database | SQLite (better-sqlite3, WAL mode) |
| Logging | Pino |
| Notifications | Slack Block Kit, nodemailer |
| Intelligence | OpenAI API, Ollama |
| Scraping | axios, cheerio, rss-parser |
| Testing | Jest, supertest |
| Deployment | Docker (multi-stage `node:24-alpine`) |

---

## Development

```bash
npm run dev              # Hot-reload with nodemon
npm test                 # Run test suite
npm run test:coverage    # With coverage report
docker compose up -d     # Full Docker environment
```

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
