# Contributing

Thanks for looking. This is a small project with a specific shape, and most of what follows is about that shape rather than about process.

## Getting it running

```bash
docker run -d --name atalaia-db -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:17
echo "DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/postgres" >> .env

./scripts/atalaia.sh up          # API, worker and console in containers
```

Any Postgres 13 or later will do — a container like that one, or something you already run. Atalaia uses no extension and no managed feature; it wants a connection string. The launcher fills in the rest, and takes about ten seconds on a machine that already has the images.

**pnpm only.** A `preinstall` hook refuses npm and yarn, because the lockfile carries security overrides that npm drops. Node 24+, pnpm 11+.

```bash
pnpm test                        # unit tests
TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/postgres pnpm test
```

Without `TEST_DATABASE_URL` the integration suites skip themselves and say so. Each suite takes its own schema, so they run in parallel against one database.

## The shape of the codebase

Clean Architecture, and the layer boundary is real: **`src/domain/` has zero external imports.** Everything else follows from that. `src/application/` holds use cases, `src/infrastructure/` holds everything that talks to something outside the process, `src/interface/` is HTTP and MCP.

`ui/` is a separate service and **imports nothing from `src/`**. It reaches the API over HTTP like any other client.

### Registries, not switches

A new feed, parser, LLM provider, email provider, queue or MCP tool is a file *and* an entry in the list that already exists:

| Adding | File | Register in |
|--------|------|-------------|
| A vulnerability source | `src/infrastructure/feeds/` | `feedRegistry.js` |
| An ecosystem | `src/infrastructure/parsers/` | `parserRegistry.js` |
| A model provider | `src/infrastructure/llm/` | `llmProviders.js` |
| An email provider | — | `emailProviders.js` |
| A tunnel | `src/infrastructure/tunnels/` | `tunnelRegistry.js` |
| A queue or schedule | — | `queue/jobs.js` |
| An MCP tool | — | `mcp/tools.js` |

Never a second list. The registry is what the health check, the console and the tests all read; a thing that exists in one place but not the list fails silently.

### Things this codebase will not do

- **Write to GitHub.** Every request goes through one GET helper and a test fails the build if a write call appears in that file.
- **Return a stored secret.** Tokens, passwords and webhooks are encrypted at rest and come back as a boolean plus the last four characters. There is no endpoint that returns one.
- **Claim something it has not checked.** A feed returning zero items is `EMPTY`, not healthy. An uncomparable version is `unknown` with a reason. An unscanned repository says so rather than reading as clean.
- **Delete.** Repositories, organizations, owners and dependencies are marked deleted. Imports never resurrect them.

### Everything is async

Postgres is not synchronous the way better-sqlite3 was, and the same mistake has four shapes, all of them a promise where a value was expected: `filter()` with an async predicate keeps everything, a route helper returning a promise makes every 404 a 200, a route factory must not be `async` because Express needs a function, and anything built at import time cannot read the database.

## Pull requests

- **One change per commit**, each one self-contained and buildable. Small commits are easier to review and far easier to revert.
- **Conventional Commits** — `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`, with an optional scope.
- **Say why, not what.** The diff already says what changed. A commit message and a comment are for the reasoning that is not in the code: what you tried, what broke, why this shape.
- **English**, everywhere: code, comments, commit messages, documentation.
- **Tests for behaviour that can regress.** Not coverage for its own sake — a test that would have caught the bug.
- **Documentation moves with the code.** `docs/` is also the published site, and its navigation is the table in `docs/README.md`. A page that is not listed there does not exist.

CI runs the full suite against a real Postgres, typechecks and builds the console, builds the documentation site, and builds both container images. It also loads the application inside the image, because a missing file once took the API down at boot while the worker stayed healthy — so the stack looked half-alive rather than broken.

## Reporting a vulnerability

Not through an issue. See [SECURITY.md](.github/SECURITY.md).

## A note on scope

Atalaia is for people with more repositories than attention. Features that add configuration without removing a decision are usually the wrong trade. If a change makes the tool say more, it should also make it say something the reader can act on.
