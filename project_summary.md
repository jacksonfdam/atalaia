# Project Summary: Atalaia

## Overview
Atalaia is a Node.js service that monitors security vulnerabilities from multiple feeds (CISA, Snyk, VulDB, CVE Details, NVD), filters by technology stack, and sends alerts to Slack. It includes a REST API for vulnerability management, LLM-powered explanations, and weekly email reports.

## Technical Stack
- **Runtime**: Node.js 20 (ES Modules)
- **Framework**: Express.js
- **Database**: SQLite via better-sqlite3 (WAL mode)
- **Logging**: Pino (JSON in production, pretty-print in dev)
- **Scheduling**: node-cron
- **Notifications**: Slack (Block Kit + interactive buttons), Email (nodemailer)
- **LLM**: OpenAI API, Ollama (provider-agnostic adapter)
- **Scraping**: axios, cheerio, rss-parser
- **Testing**: Jest (ES modules), supertest
- **Deployment**: Docker (multi-stage Alpine build), Docker Compose

## Architecture
Clean Architecture with four layers:

- **Domain** (`src/domain/`) — Pure business logic, zero external imports
  - `entities/Vulnerability.js` — Core entity with `isCritical()`, `isExploited()`, `updateStatus()`
  - `enums/Status.js` — OPEN / ACKNOWLEDGED / RESOLVED with validated transitions
  - `enums/Severity.js` — CRITICAL / HIGH / MEDIUM / LOW / UNKNOWN with normalization
  - `ports/` — Interface contracts (CachePort, FeedPort, LLMPort, NotifierPort)

- **Application** (`src/application/`) — Use cases
  - `monitorVulns.js` — Fetch feeds, filter by tech, deduplicate, generate LLM explanations, notify Slack
  - `acknowledgeVuln.js` / `resolveVuln.js` — Status transition use cases
  - `queryByTech.js` — Technology-based vulnerability lookup
  - `generateWeeklyReport.js` — Weekly report grouped by severity

- **Infrastructure** (`src/infrastructure/`) — External integrations
  - `cache/sqliteCache.js` — SQLite persistence with has/add/get/update/getAll
  - `feeds/` — Individual scrapers (CISA, Snyk, VulDB, CVE Details, NVD)
  - `llm/` — LLM adapter factory (OpenAI, Ollama, NoOp)
  - `notifySlack.js` — Slack Block Kit messages with action buttons
  - `notifiers/emailNotifier.js` — Weekly email via nodemailer
  - `scheduler.js` — Monitoring + weekly report cron jobs
  - `logger.js` — Pino structured logging
  - `config.js` — Configuration with `${ENV_VAR}` substitution

- **Interface** (`src/interface/`) — Entry points
  - `index.js` — Express server, composition root
  - `http/apiRoutes.js` — REST API (CRUD, query, stats, technologies)
  - `slack/slackActions.js` — Slack interactive message handler with HMAC verification

## Features
- Multi-source vulnerability aggregation with `Promise.allSettled`
- Technology-based filtering (configurable via API or `config/technologies.json`)
- Vulnerability status lifecycle with audit trail
- Slack Block Kit notifications with emoji headers and interactive buttons
- LLM-generated plain-English explanations (optional)
- Weekly email reports for OPEN/ACKNOWLEDGED vulnerabilities
- REST API with API key authentication
- Security headers (HSTS, nosniff, DENY frame, CORS)
- SQLite with WAL mode for concurrent access
- Structured JSON logging with Pino
- 54 unit and integration tests

## Running
```bash
npm install && cp .env.example .env
npm run dev          # Development
npm start            # Production
npm test             # Run tests
docker compose up -d # Docker
```
