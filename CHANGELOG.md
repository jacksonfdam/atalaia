# Changelog

All notable changes to this project will be documented in this file.

## [1.1.0] - 2026-03-09

### Added
- **SQLite persistence** — Replaced JSON file cache with better-sqlite3 and WAL mode
- **Vulnerability status lifecycle** — OPEN / ACKNOWLEDGED / RESOLVED with validated transitions
- **REST API** (`/api/v1`) with API key authentication (X-API-Key header)
  - `PATCH /vulnerabilities/:cveId/status` — update vulnerability status
  - `GET /vulnerabilities` — list with status/severity/source filters
  - `GET /stats` — counts grouped by status, severity, source
  - `GET /technologies` — view active technology filters
  - `POST /technologies` — update technology filters
  - `POST /query` — query vulnerabilities by technology
- **Slack interactive messages** — Block Kit format with Acknowledge/Resolve buttons
- **Enhanced Slack notifications** — Emoji headers, client explanations, @channel for critical vulns
- **Structured logging** — Pino with JSON output in production, pretty-print in development
- **LLM integration** — OpenAI and Ollama providers for plain-English CVE explanations
- **Weekly email reports** — Grouped by severity via nodemailer (SMTP)
- **Technology configuration API** — Runtime-updateable filters in `config/technologies.json`
- **API security** — CORS, security headers (nosniff, HSTS, X-Frame-Options)
- **Docker Compose** — Development setup with volume mounting and health checks
- **Test suite** — 54 unit and integration tests with Jest (ES modules)

### Changed
- Split `fetchFeeds.js` into individual feed modules under `infrastructure/feeds/`
- Moved `Vulnerability` entity to `domain/entities/`
- Added `domain/enums/` for Status and Severity
- Dockerfile updated with HEALTHCHECK and multi-stage build improvements
- Configuration supports `${ENV_VAR}` substitution in `config.json`

### Deprecated
- JSON file caching (replaced by SQLite)

## [1.0.0] - Initial Release

### Added
- Multi-source vulnerability monitoring (CISA, Snyk, VulDB, CVE Details)
- Slack webhook notifications with severity formatting
- Cron-based scheduling
- Docker deployment
- Health check endpoint
