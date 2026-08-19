# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Atalaia monitors public vulnerability feeds, filters findings against the technologies the user ships, correlates them with imported GitHub repositories, and alerts through Slack, Microsoft Teams and email.

**Three processes, one Postgres.** The **API** (`src/interface/index.js`, Express, port 3000) serves requests and enqueues work. The **worker** (`src/interface/worker.js`, no port) takes jobs off the queue and does it. The **console** (`ui/`, React + a BFF, port 3001) talks only to the API. The database is any Postgres 13+, reached through `DATABASE_URL`, and it also holds the queue (pg-boss) and the schedules. Nothing host-specific is used, so a container, a managed instance or a local Supabase all work the same.

ES modules throughout (`"type": "module"`); the CLI under `src/cli/` is TypeScript compiled to `dist/`, and is an HTTP client of the API.

User-facing documentation lives in `README.md` (short) and `docs/` (everything else). Keep both in step with behaviour changes. `docs/` is also the published site (`docs/site/build.mjs` → Vercel): the index table in `docs/README.md` is its navigation, so a new page must be listed there to exist.

## Commands

```bash
docker run -d --name atalaia-db -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:17   # DATABASE_URL points at it
./scripts/atalaia.sh up          # API + worker + console (Docker, else Apple container)
./scripts/atalaia.sh down|status|logs|doctor

pnpm run dev                     # API only, nodemon
pnpm run dev:worker              # worker only, nodemon
pnpm start | pnpm run start:worker
TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54622/postgres pnpm test
pnpm run build:cli               # tsc -p tsconfig.cli.json (also runs on install)
pnpm run dev:cli                 # CLI from source via tsx
pnpm --filter atalaia-console run build|dev:client|typecheck
```

**pnpm only.** A `preinstall` hook refuses npm and yarn — the lockfile carries security overrides npm drops. Node 24+, pnpm 11+.

**Containers only to run.** There is no local process mode: `atalaia.sh` drives Docker Compose or Apple's `container`, generated from one table of service definitions so the two cannot drift.

**Tests without a database** skip the integration suites and say so. With `TEST_DATABASE_URL`, each suite takes its own Postgres schema *and* its own pg-boss schema.

## Architecture

Clean Architecture with strict layer boundaries — **`src/domain/` has zero external imports**.

- **`src/domain/`** — `entities/` (`Vulnerability`, `Repository`, `Dependency`, `SystemOwner`, `OwnerAssignment`), `enums/` (`Severity`, `Status`, `Ecosystem`), `ports/` (`CachePort`, `FeedPort`, `NotifierPort`, `LLMPort`, `RepositoryStorePort`, `RepositoryProviderPort`, `DependencyParserPort`)
- **`src/application/`** — use cases: `monitorVulns.js` (fetch → filter → dedupe → notify), `scanRepository.js` / `scanAllRepositories.js`, `checkDependencyVersions.js`, `correlateVulnerability.js`, `generateWeeklyReport.js`, `acknowledgeVuln.js` / `resolveVuln.js`, `manageOrganization.js` / `manageRepository.js` / `manageOwner.js`
- **`src/infrastructure/`** — external integrations:
  - `feeds/` — one file per source, all listed in `feedRegistry.js` (the single list both the monitoring cycle and the health check read). Runtime enable/disable is persisted in `feed_state`
  - `parsers/` — one file per ecosystem, registered in `parserRegistry.js` (npm, pip, Go, Cargo, Maven, Gradle + version catalogs, RubyGems, NuGet, Composer, Terraform, Swift, CocoaPods, Docker, GitHub Actions)
  - `db/` — `pool.js` (one `pg` pool; named `@param` bindings translated to `$1`) and `migrationRunner.js` (one transaction per file, behind a `pg_advisory_lock`)
  - `queue/` — `jobs.js` (the one list of queues and schedules), `boss.js` (pg-boss, enqueue, state, progress), `workers.js` (handlers)
  - `cache/` — `postgresCache.js` (vulnerabilities), `repositoryStore.js`, `organizationStore.js`
  - `notifiers/` — Slack, Teams, Telegram, email (`emailProviders.js` catalog, nodemailer transport) and their config modules
  - `tunnels/` — public URLs for callbacks; one file per provider (ngrok, cloudflared), listed in `tunnelRegistry.js`. `PUBLIC_URL` beats any tunnel
  - `llm/` — provider catalog (`llmProviders.js`) plus OpenAI-compatible, Anthropic and Ollama adapters; prompts in `llm/prompts/*.txt`
  - `providers/githubProvider.js` — **read-only**; every request goes through one GET helper and a test fails the build if a write call appears there
  - `registries/` — latest-version lookups per ecosystem; `crypto.js` — AES-256-GCM for secrets at rest; `config.js`, `settings.js` (read-through cache, 30s TTL), `logger.js` (Pino)
- **`src/interface/`** — `index.js` is the API's composition root (dotenv, `await initializeDatabase()`, `createApp(cache)`, listen, dev-only ngrok/Slack bootstrap). `worker.js` is the worker's: migrate, register workers, register schedules. Routes split per resource under `http/`; `slack/slackActions.js` handles signature-verified button callbacks; `mcp/` is the agent-facing Model Context Protocol server (`tools.js` is the one list, `server.js` builds it), mounted stateless at `/mcp` behind the same API key
- **`src/cli/`** — commander commands plus an Ink dashboard, over HTTP (`lib/api.ts`); `--api <url>` or `ATALAIA_API_URL`
- **`ui/`** — separate service, **no imports from `src/`**. `server/` is a BFF (session cookie auth, injects `X-API-Key` server-side); `src/` is the React client

## Key Conventions

- **Everything is async.** Postgres is not synchronous the way better-sqlite3 was. Four traps found the hard way during the migration, all the same shape — a promise where a value was expected: `filter()` with an async predicate keeps *everything* (a promise is truthy), a route helper returning a promise makes every 404 a 200, a route/handler factory must **not** be async because Express needs a function, and anything built at import time cannot read the database.
- **Long work is a job, not a request.** If it can outlive an HTTP timeout it belongs in `queue/jobs.js` and runs in the worker. `exclusive` queue policy is how "only one at a time" is enforced — in the database, so it survives a restart and holds across containers.
- **Registries over switches.** New feed, parser, LLM provider, email provider, queue or MCP tool → add the file *and* register it. Never a second list.
- **Environment beats database beats `config.json`.** An env-pinned value turns the matching console field read-only; a write that would have no effect is refused with `409`.
- **Secrets encrypted at rest, never returned.** Tokens, SMTP passwords, Slack credentials and LLM keys go through `crypto.js`; the API exposes only "configured" plus the last four characters.
- **Read-only outward.** GitHub, feeds and package registries are read, never written.
- **Long work runs detached.** Fleet scans, version checks and monitoring cycles answer `202`, refuse a concurrent run with `409`, and report progress on `GET` at the same path.
- **Soft deletes.** Repositories, organizations, owners and dependencies are marked deleted; imports never resurrect them, and never flip the operator's `enabled` switch.
- **A lockfile supersedes the manifest beside it.** A parser that reads resolved versions says so with `export const resolvesVersions = true`, and `reconcileDependencies.js` drops the constraint row for the same package in the same directory tree. Never a list of lockfile names in the scanner.
- **Counts and filters share one SQL definition**, so a header can never disagree with its rows.
- **Nothing unverified is claimed.** A feed returning zero items is `EMPTY`, not healthy; an uncomparable version is `unknown` with a reason; an unscanned repository says so rather than reading as clean.
- Vulnerability identity is `cve_id`; status lifecycle is `OPEN → ACKNOWLEDGED → RESOLVED`.
- `affected_technologies`, `languages` and `topics` are **jsonb**: they come back parsed, so nothing calls `JSON.parse` on them, and "does this array contain that name" is element equality rather than a substring hunt.
- Booleans are real booleans, timestamps are `timestamptz`, ids are identity columns. No 0/1 flags.
- Feed adapters return `Vulnerability[]` and handle their own errors — `Promise.allSettled`, so one failure never blocks the cycle.
- ES modules with explicit `.js` extensions in imports; `#app/*` maps to `./src/*`.
- Migrations in `db/migrations/`, applied on boot in filename order, one transaction each.
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
