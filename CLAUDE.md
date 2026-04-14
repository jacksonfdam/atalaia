# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Atalaia is a Node.js service that monitors security vulnerabilities from multiple feeds (CISA, Snyk, VulDB, CVE Details) and sends formatted alerts to Slack. It uses Clean Architecture with ES modules (`"type": "module"`).

## Commands

```bash
npm run dev          # Development with hot-reload (nodemon)
npm run start        # Production mode
```

No test runner is currently configured in package.json. Jest and supertest are in devDependencies; the project plans to use `node --experimental-vm-modules node_modules/.bin/jest` for ES module support.

## Architecture

Clean Architecture with four layers — **domain has zero external imports**:

- **`src/domain/entities/`** — Pure business entities (e.g., `Vulnerability` class with `isCritical()`, `isExploited()`)
- **`src/application/`** — Use cases orchestrating business logic (`monitorVulns.js`: fetch feeds → filter by tech → deduplicate via cache → notify Slack)
- **`src/infrastructure/`** — External integrations:
  - `cache/sqliteCache.js` — better-sqlite3 persistence (replaced old JSON file cache). Uses `has(cveId)` / `add(vuln)` / `getAll()`
  - `fetchFeeds.js` — All scrapers in one file (CISA JSON, Snyk HTML scraping, VulDB RSS, CVE Details HTML scraping). Uses `Promise.allSettled` so one feed failure doesn't block others
  - `notifySlack.js` — Slack webhook notifications with severity-based formatting
  - `scheduler.js` — node-cron wrapper
  - `config.js` — Reads `config.json`, substitutes `${ENV_VAR}` placeholders, allows `.env` overrides
- **`src/interface/index.js`** — Entry point / composition root: Express server, DB init, scheduler start, immediate first monitoring cycle

## Key Configuration

- **`config.json`** — Feed URLs, cron schedule, Slack webhook (via env substitution), and technology filter settings
- **`.env`** — `SLACK_WEBHOOK_URL`, `PORT` (default 3000), `CRON_SCHEDULE` (overrides config.json), `DB_PATH` (default `data/atalaia.db`)
- **`db/migrations/001_initial.sql`** — SQLite schema, run on startup by `initializeDatabase()`

## Data Flow

1. Scheduler triggers `monitorVulns()`
2. `fetchFeeds()` calls all 4 scrapers concurrently via `Promise.allSettled`
3. Results filtered by technologies from `config.json` (case-insensitive match against title/description/link)
4. Deduplicated against SQLite cache (`has()` checks by `cve_id`)
5. New vulns sent to Slack and persisted to SQLite

## Active Migration Plan

The project is mid-migration per `rules.md`. Key planned changes:
- Split `fetchFeeds.js` monolith into individual `infrastructure/feeds/*.js` files
- Add port interfaces in `domain/ports/` for dependency injection
- Add vulnerability status lifecycle (OPEN/ACKNOWLEDGED/RESOLVED)
- Add LLM integration for client-friendly explanations
- Add REST API (`/api/v1/`) with API key auth
- Add weekly email reports via nodemailer
- Replace `console.log` with Pino structured logging
- Enhance Slack messages with Block Kit and interactive buttons

## Conventions

- ES modules throughout (`import`/`export`, `.js` extensions in imports)
- Vulnerability identity is `cve_id` (unique key in SQLite)
- Scraper functions return `Vulnerability[]`; each handles its own errors internally
- Config values support `${ENV_VAR}` substitution pattern
- Docker uses multi-stage build with `node:24-alpine`

## Workflow Orchestration

### Planning
- Enter plan mode for any non-trivial task (3+ steps or architectural decisions)
- For sideways issues: **STOP and ask** before continuing
- Use plan mode for verification steps, not just implementation
- Write detailed specs upfront to reduce ambiguity

### Execution Strategy
- Use subagents liberally to keep main context clean
- Offload research, exploration, and parallel analysis to subagents
- One focused task per subagent for better results

### Task Management
- Mark tasks in `tasks/todo.md` with checkable items as you progress
- Update status in real-time; mark complete only when **fully verified**
- Never mark a task complete without proving it works
- Track high-level progress via review sections

### Verification Before Done
- Diff behavior between main branch and your changes when relevant
- Ask yourself: "Would a staff engineer approve this?"
- Run tests, check logs, demonstrate correctness
- Only mark complete after verification, not during implementation

### Demand Elegance
- Pause on non-trivial changes; ask "Is there a more elegant way?"
- For fixes that feel hacky: implement the elegant solution instead
- Keep solutions simple and obvious over complex and clever
- Skip this for trivial changes; don't over-engineer

### Autonomous Bug Fixing
- Point at logs, errors, failing tests → just fix them
- Zero context-switching; resolve blockers inline
- Go fix failing CI tests without being told how

## Core Principles

**Simplicity First** — Make every change as simple as possible. Impact minimal code.

**No Laziness** — Find root causes; no temporary fixes. Senior developer standards.

**Minimal Impact** — Changes should only touch what's necessary. Avoid gratuitous refactoring.
