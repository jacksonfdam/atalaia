# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Atalaia monitors public vulnerability feeds, filters findings against the technologies the user ships, correlates them with imported GitHub repositories, and alerts through Slack, Microsoft Teams and email. Two services in one pnpm workspace: the **API** (`src/`, Express, port 3000) and the **management console** (`ui/`, React + a BFF, port 3001). ES modules throughout (`"type": "module"`); the CLI under `src/cli/` is TypeScript compiled to `dist/`.

User-facing documentation lives in `README.md` (short) and `docs/` (everything else). Keep both in step with behaviour changes.

## Commands

```bash
./scripts/atalaia.sh up          # start API + console (Docker if available, local otherwise)
./scripts/atalaia.sh up --local --dev   # hot-reload both
./scripts/atalaia.sh down|status|logs|doctor

pnpm run dev                     # API only, nodemon
pnpm start                       # API only, production
pnpm test                        # Jest (ES modules via --experimental-vm-modules)
pnpm run test:watch
pnpm run test:coverage
pnpm run build:cli               # tsc -p tsconfig.cli.json (also runs on install)
pnpm run dev:cli                 # CLI from source via tsx
pnpm --filter atalaia-console run build|dev:client|typecheck
```

**pnpm only.** A `preinstall` hook refuses npm and yarn — the lockfile carries security overrides npm drops. Node 24+, pnpm 11+.

## Architecture

Clean Architecture with strict layer boundaries — **`src/domain/` has zero external imports**.

- **`src/domain/`** — `entities/` (`Vulnerability`, `Repository`, `Dependency`, `SystemOwner`, `OwnerAssignment`), `enums/` (`Severity`, `Status`, `Ecosystem`), `ports/` (`CachePort`, `FeedPort`, `NotifierPort`, `LLMPort`, `RepositoryStorePort`, `RepositoryProviderPort`, `DependencyParserPort`)
- **`src/application/`** — use cases: `monitorVulns.js` (fetch → filter → dedupe → notify), `scanRepository.js` / `scanAllRepositories.js`, `checkDependencyVersions.js`, `correlateVulnerability.js`, `generateWeeklyReport.js`, `acknowledgeVuln.js` / `resolveVuln.js`, `manageOrganization.js` / `manageRepository.js` / `manageOwner.js`
- **`src/infrastructure/`** — external integrations:
  - `feeds/` — one file per source, all listed in `feedRegistry.js` (the single list both the monitoring cycle and the health check read). Runtime enable/disable is persisted in `feed_state`
  - `parsers/` — one file per ecosystem, registered in `parserRegistry.js` (npm, pip, Go, Cargo, Maven, Gradle + version catalogs, RubyGems, NuGet, Composer, Terraform, Docker, GitHub Actions)
  - `cache/` — `sqliteCache.js` (better-sqlite3, WAL), `repositoryStore.js`, `organizationStore.js`, `migrationRunner.js`
  - `notifiers/` — Slack, Teams, email (`emailProviders.js` catalog, nodemailer transport) and their config modules
  - `llm/` — provider catalog (`llmProviders.js`) plus OpenAI-compatible, Anthropic and Ollama adapters; prompts in `llm/prompts/*.txt`
  - `providers/githubProvider.js` — **read-only**; every request goes through one GET helper and a test fails the build if a write call appears there
  - `registries/` — latest-version lookups per ecosystem; `crypto.js` — AES-256-GCM for secrets at rest; `config.js`, `settings.js`, `logger.js` (Pino), `scheduler.js` (node-cron)
- **`src/interface/`** — `index.js` is the composition root (dotenv, `initializeDatabase()`, `createApp(cache)`, listen, dev-only ngrok/Slack bootstrap, `startScheduler()`, one immediate cycle). Routes split per resource under `http/`; `slack/slackActions.js` handles signature-verified button callbacks
- **`src/cli/`** — commander commands plus an Ink dashboard; reads SQLite directly
- **`ui/`** — separate service, **no imports from `src/`**. `server/` is a BFF (session cookie auth, injects `X-API-Key` server-side); `src/` is the React client

## Key Conventions

- **Registries over switches.** New feed, parser, LLM provider or email provider → add the file *and* register it. Never a second list.
- **Environment beats database beats `config.json`.** An env-pinned value turns the matching console field read-only; a write that would have no effect is refused with `409`.
- **Secrets encrypted at rest, never returned.** Tokens, SMTP passwords, Slack credentials and LLM keys go through `crypto.js`; the API exposes only "configured" plus the last four characters.
- **Read-only outward.** GitHub, feeds and package registries are read, never written.
- **Long work runs detached.** Fleet scans, version checks and monitoring cycles answer `202`, refuse a concurrent run with `409`, and report progress on `GET` at the same path.
- **Soft deletes.** Repositories, organizations, owners and dependencies are marked deleted; imports never resurrect them, and never flip the operator's `enabled` switch.
- **Counts and filters share one SQL definition**, so a header can never disagree with its rows.
- **Nothing unverified is claimed.** A feed returning zero items is `EMPTY`, not healthy; an uncomparable version is `unknown` with a reason; an unscanned repository says so rather than reading as clean.
- Vulnerability identity is `cve_id`; status lifecycle is `OPEN → ACKNOWLEDGED → RESOLVED`.
- Feed adapters return `Vulnerability[]` and handle their own errors — `Promise.allSettled`, so one failure never blocks the cycle.
- ES modules with explicit `.js` extensions in imports; `#app/*` maps to `./src/*`.
- Migrations in `db/migrations/`, applied on startup in filename order.
- Tests in `tests/unit/` and `tests/integration/`; HTTP tests mount `createApp()` with a stub cache, so no port opens and no feed is fetched.

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

## Core Principles

**Simplicity First** — Make every change as simple as possible. Impact minimal code.

**No Laziness** — Find root causes; no temporary fixes. Senior developer standards.

**Minimal Impact** — Changes should only touch what's necessary. Avoid gratuitous refactoring.
