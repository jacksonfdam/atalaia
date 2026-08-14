# Running Atalaia

Atalaia is two services: the **API** (`src/`, port 3000) and the **management console** (`ui/`, port 3001). They can run together or apart, in Docker or as plain Node processes.

## The launcher

`scripts/atalaia.sh` is the supported way to start both, in either mode. It exists because the two services need the same secrets and the console server — unlike the API — does not read `.env` on its own, so something has to wire the values through.

```bash
./scripts/atalaia.sh <command> [options]
```

| Command | What it does |
|---------|--------------|
| `up` | Start API + console. Docker when available, local otherwise. |
| `down` | Stop everything the launcher started (both modes). |
| `restart` | `down` followed by `up`. |
| `status` | Health of both services and what is currently running. |
| `logs [api\|console]` | Follow logs — `docker compose logs` in Docker mode, `.run/*.log` locally. |
| `init` | Create `.env` from `.env.example` and generate missing secrets. |
| `install` | Install dependencies with pnpm. |
| `build` | Build the console bundle and the CLI. |
| `test` | Run the test suite. |
| `doctor` | Check prerequisites (Node, pnpm, Docker) and configuration. |

| Option | Effect |
|--------|--------|
| `--docker` | Force Docker mode. |
| `--local` | Force local mode, no Docker. |
| `--dev` | Local mode with hot-reload (nodemon). Implies `--local`. |
| `--build` | Rebuild images / the console bundle before starting. |
| `--no-console` | Start the API only. |
| `--skip-install` | Local mode: skip `pnpm install`. |
| `-h`, `--help` | Full usage. |

```bash
./scripts/atalaia.sh up --docker --build   # rebuild images and start
./scripts/atalaia.sh up --local --dev      # hot-reload API + console
./scripts/atalaia.sh up --no-console       # API only
./scripts/atalaia.sh logs api
./scripts/atalaia.sh status
./scripts/atalaia.sh down
```

The same commands are available as package scripts: `pnpm run up`, `pnpm run up:docker`, `pnpm run up:local`, `pnpm run down`, `pnpm run status`, `pnpm run logs`, `pnpm run doctor`.

**Ports.** The launcher reads `PORT` and `UI_PORT` from `.env` — or from the environment, which wins — so `PORT=8000 ./scripts/atalaia.sh up` moves the API and its health check together. `docker-compose.yml` interpolates the same variables, so the published port never drifts from the port the process listens on.

## With Docker

Requirements: Docker with Compose v2.

```bash
cp .env.example .env          # or: ./scripts/atalaia.sh init
docker compose up -d --build
docker compose ps             # both services should be "healthy"
docker compose logs -f
docker compose down
```

Two containers are started:

| Service | Image | Port | Health |
|---------|-------|------|--------|
| `atalaia` | multi-stage `node:24-alpine`, built from `Dockerfile` | `3000` | `GET /health` |
| `atalaia-console` | multi-stage `node:24-alpine`, built from `ui/Dockerfile` | `3001` | `GET /healthz` |

The console waits for the API to report healthy (`depends_on: service_healthy`) and reaches it over the compose network at `http://atalaia:3000` — never over `localhost`, which inside a container points at the container itself. The SQLite database is bind-mounted at `./data`, so it survives `docker compose down`.

`better-sqlite3` has no musl prebuilds and is compiled from source in the builder stage; the first build takes a few minutes, later builds hit the layer cache.

## Without Docker

Requirements: Node.js 24+ and pnpm 11+ (`corepack enable` gives you pnpm).

This repository is pnpm-managed and a `preinstall` hook refuses npm and yarn: the lockfile carries security overrides that npm silently drops.

```bash
corepack enable
pnpm install                                  # root + ui workspaces

cp .env.example .env                          # fill in API_KEY, UI_PASSWORD, UI_SESSION_SECRET
# openssl rand -hex 32   generates a good value for the last two

pnpm start                                    # API on :3000
```

In a second terminal, for the console:

```bash
pnpm --filter atalaia-console run build       # build the client bundle once
node ui/server/index.js                       # console on :3001
```

The console server reads `API_KEY`, `UI_PASSWORD` and `UI_SESSION_SECRET` from its process environment and does not load `.env` itself. Either export them, or let `./scripts/atalaia.sh up --local` pass them through for you.

## Development mode

```bash
./scripts/atalaia.sh up --local --dev     # API with nodemon + console on :3001
```

Or by hand, one process per terminal:

```bash
pnpm run dev                                   # API, hot-reload via nodemon
node ui/server/index.js                        # console BFF (auth + API-key proxy)
pnpm --filter atalaia-console run dev:client   # Vite dev server on :5173
```

With Vite running, open **http://localhost:5173** — it proxies `/bff` and `/auth` to the console server (`BFF_URL`, default `http://localhost:3001`), so cookies stay same-origin from the browser's point of view.

In non-production (`NODE_ENV !== 'production'`) the API also tries to open an ngrok tunnel and point your Slack app's Request URL at it, so Slack's Acknowledge/Resolve buttons reach your laptop. It needs `NGROK_AUTH_TOKEN`, `SLACK_APP_TOKEN` and `SLACK_APP_ID`; without them it logs a warning and carries on.

## Local process state

Local mode writes to `.run/` (git-ignored):

```
.run/api.pid        .run/api.log
.run/console.pid    .run/console.log
```

`up` refuses to start a service whose PID file points at a live process, so it is safe to run twice.
