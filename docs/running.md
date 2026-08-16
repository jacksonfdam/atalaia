# Running Atalaia

Atalaia runs in containers. There are three of them — the **API** (port 3000), the **worker** (no port) and the **management console** (port 3001) — and they all talk to one Postgres.

That Postgres is **Supabase**, and it is deliberately not one of the containers: locally it is the stack the `supabase` CLI brings up, in production it is a cloud project. Either way the services reach it through `DATABASE_URL`.

## The database first

```bash
supabase start
```

The CLI prints a connection string when it finishes. This repository's `supabase/config.toml` moves the stack to ports `546xx` (the usual `5432x` were taken by other projects on the machine this was set up on), so the local database is:

```
postgresql://postgres:postgres@127.0.0.1:54622/postgres
```

Put it in `.env` as `DATABASE_URL`. In production, use your project's **session** connection string — port 5432, not the 6543 pooler. `./scripts/atalaia.sh doctor` warns if it sees 6543: pgbouncer in transaction mode breaks prepared statements and `LISTEN`, and the queue needs both.

Migrations run themselves. Both the API and the worker apply any pending ones on boot, behind an advisory lock so they cannot race.

## The launcher

```bash
./scripts/atalaia.sh up
```

It creates `.env` from `.env.example` if it is missing, generates the secrets that have no sensible default (`API_KEY`, `UI_SESSION_SECRET`, `UI_PASSWORD`), starts the three containers, and waits until the API and the console answer their health endpoints. Docker if the daemon answers, Apple's `container` otherwise.

| Command | What it does |
|---------|--------------|
| `up` | Start API, worker and console. |
| `down` | Stop everything the launcher started, in either runtime. |
| `restart` | `down` followed by `up`. |
| `status` | Health of each service and what is currently running. |
| `logs [service]` | Follow logs. Service names: `atalaia`, `atalaia-worker`, `atalaia-console`. |
| `init` | Create `.env` from `.env.example` and generate missing secrets. |
| `install` | Install dependencies with pnpm — for developing, not for running. |
| `build` | Build the console bundle and the CLI. |
| `test` | Run the test suite. |
| `doctor` | Check the runtime, the database and the configuration. |

| Option | Effect |
|--------|--------|
| `--docker` | Force Docker Compose. |
| `--container` | Force Apple's container CLI. |
| `--build` | Rebuild images before starting. |
| `--no-console` | Start the API and the worker only. |
| `-h`, `--help` | Full usage. |

```bash
./scripts/atalaia.sh up --build
./scripts/atalaia.sh logs atalaia-worker
./scripts/atalaia.sh status
./scripts/atalaia.sh down
```

**Ports.** The launcher reads `PORT` and `UI_PORT` from `.env` — or from the environment, which wins — and `docker-compose.yml` interpolates the same variables, so the published port never drifts from the port the process listens on.

## What each container is

| Service | Image | Port | Health |
|---------|-------|------|--------|
| `atalaia` | multi-stage `node:24-alpine`, from `Dockerfile` | `3000` | `GET /health` |
| `atalaia-worker` | the same image, `node src/interface/worker.js` | none | it exits if it cannot reach Postgres, and is restarted |
| `atalaia-console` | multi-stage `node:24-alpine`, from `ui/Dockerfile` | `3001` | `GET /healthz` |

The **worker** is where the work happens: feed cycles, repository scans, dependency freshness and the weekly report all run there, taken off the queue. The API only serves requests and enqueues jobs. That separation is why a scan no longer competes with the console for the same event loop, and why killing the API mid-scan no longer loses it. See [queues.md](queues.md).

The console waits for the API to report healthy and reaches it over the compose network at `http://atalaia:3000` — never `localhost`, which inside a container is the container itself.

Nothing mounts a volume: there is no state on this side any more.

## With Docker directly

One thing the launcher does that a bare `docker compose up` does not: **translate the database host**.

A local Supabase lives on the host, so `.env` says `127.0.0.1` — which is what the CLI, the tests and `doctor` need. Inside a container that address is the container itself, and the connection is refused with `ECONNREFUSED 127.0.0.1:54622`. Compose reads `.env` for interpolation, so it passes the host-shaped URL straight through.

Export a container-reachable URL yourself, or use the launcher:

```bash
cp .env.example .env          # or: ./scripts/atalaia.sh init

export DATABASE_URL=postgresql://postgres:postgres@host.docker.internal:54622/postgres
docker compose up -d --build
docker compose ps             # all three should be "healthy"
docker compose logs -f atalaia-worker
docker compose down
```

A remote database needs no translation: its host is already on the network. `./scripts/atalaia.sh doctor` prints the URL the containers will get whenever it differs from the one in `.env`.

More workers, if one is not keeping up:

```bash
docker compose up -d --scale atalaia-worker=3
```

The queue hands each job to exactly one of them, and the exclusive queues stay exclusive across all of them — that guarantee lives in Postgres, not in the process.

## With Apple container

macOS 15+, no Docker Desktop:

```bash
container system start
./scripts/atalaia.sh up --container
```

Apple's runtime has no compose, so the launcher creates a network, builds each image and starts each container itself, polling the health endpoint between them where compose would have used `depends_on: service_healthy`. Both paths are generated from one table of service definitions in `scripts/atalaia.sh` so they cannot drift.

> This path is written but not yet exercised: the machine this was built on has no Apple container installed. The Docker path is verified.

## Developing

The services still run in containers; the tooling around them does not.

```bash
corepack enable
pnpm install                                   # root + ui workspaces

supabase start
TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54622/postgres pnpm test

pnpm --filter atalaia-console run dev:client   # Vite on :5173, proxying to the console
pnpm run dev:cli                               # the terminal client from source
```

`pnpm test` without `TEST_DATABASE_URL` runs the unit suites and skips the integration ones, saying so.

In non-production (`NODE_ENV !== 'production'`) the API opens a tunnel and hands the URL to Slack and Telegram, so their Acknowledge/Resolve buttons reach your laptop. `TUNNEL_PROVIDER` picks one: `auto` (the default) takes ngrok when `NGROK_AUTH_TOKEN` is set and Cloudflare's quick tunnel otherwise, which needs no account; `none` opens nothing. Slack also needs `SLACK_APP_TOKEN` and `SLACK_APP_ID` to have its Request URL updated. Set `PUBLIC_URL` and no tunnel is opened at all — a hostname you own wins.
