#!/usr/bin/env bash
#
# Atalaia launcher — brings up the API and the management console, with or
# without Docker, from a single command.
#
# Both services need the same secrets, and the console server does not read
# .env on its own (it is a plain Node process, not a dotenv consumer). This
# script is the one place that knows how to wire that up in either mode.
#
#   ./scripts/atalaia.sh up            # Docker if the daemon is up, else local
#   ./scripts/atalaia.sh up --local    # force local processes
#   ./scripts/atalaia.sh up --docker   # force docker compose
#   ./scripts/atalaia.sh --help
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# ATALAIA_ENV_FILE exists so the bootstrap can be exercised without touching the
# real .env; everything else should leave it unset.
ENV_FILE="${ATALAIA_ENV_FILE:-$ROOT/.env}"
ENV_EXAMPLE="$ROOT/.env.example"
RUN_DIR="$ROOT/.run"

# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------

if [ -t 1 ]; then
    C_RESET=$'\033[0m'; C_DIM=$'\033[2m'; C_BLUE=$'\033[34m'
    C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'; C_RED=$'\033[31m'
else
    C_RESET=''; C_DIM=''; C_BLUE=''; C_GREEN=''; C_YELLOW=''; C_RED=''
fi

log()  { printf '%s==>%s %s\n' "$C_BLUE" "$C_RESET" "$*"; }
ok()   { printf '%s  ok%s %s\n' "$C_GREEN" "$C_RESET" "$*"; }
warn() { printf '%swarn%s %s\n' "$C_YELLOW" "$C_RESET" "$*" >&2; }
dim()  { printf '%s     %s%s\n' "$C_DIM" "$*" "$C_RESET"; }
die()  { printf '%s fail%s %s\n' "$C_RED" "$C_RESET" "$*" >&2; exit 1; }

have() { command -v "$1" >/dev/null 2>&1; }

# ---------------------------------------------------------------------------
# .env handling
# ---------------------------------------------------------------------------

# Read a single key from .env. Comments, surrounding whitespace and wrapping
# quotes are stripped; the last assignment wins, matching dotenv.
env_get() {
    [ -f "$ENV_FILE" ] || return 0
    awk -v key="$1" '
        /^[[:space:]]*#/ { next }
        {
            line = $0
            sub(/^[[:space:]]*(export[[:space:]]+)?/, "", line)
            eq = index(line, "=")
            if (eq == 0) next
            k = substr(line, 1, eq - 1)
            v = substr(line, eq + 1)
            sub(/[[:space:]]+$/, "", k)
            if (k != key) next
            sub(/^[[:space:]]+/, "", v)
            sub(/[[:space:]]+$/, "", v)
            if (v ~ /^".*"$/ || v ~ /^'"'"'.*'"'"'$/) v = substr(v, 2, length(v) - 2)
            print v
        }
    ' "$ENV_FILE" | tail -n 1
}

# Write a key, replacing an existing assignment or appending a new one.
env_set() {
    local key="$1" value="$2" tmp
    tmp="$(mktemp)"

    if [ -s "$ENV_FILE" ] && [ "$(tail -c 1 "$ENV_FILE" | wc -l)" -eq 0 ]; then
        printf '\n' >> "$ENV_FILE"   # a missing final newline would glue lines together
    fi

    if grep -qE "^[[:space:]]*(export[[:space:]]+)?${key}=" "$ENV_FILE" 2>/dev/null; then
        awk -v key="$key" -v value="$value" '
            $0 ~ "^[[:space:]]*(export[[:space:]]+)?" key "=" { print key "=" value; next }
            { print }
        ' "$ENV_FILE" > "$tmp"
    else
        [ -f "$ENV_FILE" ] && cat "$ENV_FILE" > "$tmp"
        printf '%s=%s\n' "$key" "$value" >> "$tmp"
    fi

    mv "$tmp" "$ENV_FILE"
}

random_hex() {
    if have openssl; then
        openssl rand -hex "${1:-32}"
    else
        node -e "console.log(require('node:crypto').randomBytes(${1:-32}).toString('hex'))"
    fi
}

# .env.example ships placeholders for the secrets. Treating them as unset is
# what makes `up` work on a fresh clone without a manual editing step.
is_placeholder() {
    case "$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')" in
        ''|your*|changeme*|change-me*|change_me*|replace*|todo*|xxx*|'<'*) return 0 ;;
        *) return 1 ;;
    esac
}

# Create .env on first run and fill in the secrets that have no sensible
# default. Never touches a value that is already set to something real.
ensure_env() {
    if [ ! -f "$ENV_FILE" ]; then
        [ -f "$ENV_EXAMPLE" ] || die "Neither .env nor .env.example exists."
        cp "$ENV_EXAMPLE" "$ENV_FILE"
        log "Created .env from .env.example"
    fi

    is_placeholder "$(env_get API_KEY)"           && { env_set API_KEY "$(random_hex 32)";           ok "Generated API_KEY"; }
    is_placeholder "$(env_get UI_SESSION_SECRET)" && { env_set UI_SESSION_SECRET "$(random_hex 32)"; ok "Generated UI_SESSION_SECRET"; }

    if is_placeholder "$(env_get UI_PASSWORD)"; then
        local generated
        generated="$(random_hex 8)"
        env_set UI_PASSWORD "$generated"
        ok "Generated UI_PASSWORD: ${generated}"
        dim "Change it in .env if you want something memorable."
    fi
}

# Ports: an exported variable wins over .env, which wins over the default —
# the same precedence dotenv gives the services themselves.
API_PORT() { local p="${PORT:-}"; [ -n "$p" ] || p="$(env_get PORT)"; printf '%s' "${p:-3000}"; }
UI_PORT_() { local p="${UI_PORT:-}"; [ -n "$p" ] || p="$(env_get UI_PORT)"; printf '%s' "${p:-3001}"; }

# ---------------------------------------------------------------------------
# Health polling
# ---------------------------------------------------------------------------

wait_http() {
    local url="$1" label="$2" timeout="${3:-60}" waited=0
    while [ "$waited" -lt "$timeout" ]; do
        if curl -fsS -o /dev/null --max-time 2 "$url" 2>/dev/null; then
            ok "$label is up — $url"
            return 0
        fi
        sleep 1
        waited=$((waited + 1))
    done
    warn "$label did not answer on $url within ${timeout}s"
    return 1
}

# ---------------------------------------------------------------------------
# Docker mode
# ---------------------------------------------------------------------------

compose() {
    if docker compose version >/dev/null 2>&1; then
        docker compose "$@"
    else
        docker-compose "$@"
    fi
}

docker_ready() { have docker && docker info >/dev/null 2>&1; }

up_docker() {
    docker_ready || die "Docker is not running. Start Docker Desktop, or use: $0 up --local"

    log "Starting Docker services"
    if [ "$REBUILD" = "1" ]; then
        compose up -d --build
    else
        compose up -d
    fi

    wait_http "http://localhost:$(API_PORT)/health" "API" 120 || true
    if [ "$WITH_CONSOLE" = "1" ]; then
        wait_http "http://localhost:$(UI_PORT_)/healthz" "Console" 120 || true
    fi
    summary
}

down_docker() {
    docker_ready || return 0
    log "Stopping Docker services"
    compose down
}

# ---------------------------------------------------------------------------
# Local mode
# ---------------------------------------------------------------------------

pid_file()  { printf '%s/%s.pid' "$RUN_DIR" "$1"; }
log_file()  { printf '%s/%s.log' "$RUN_DIR" "$1"; }

running() {
    local pid
    pid="$(cat "$(pid_file "$1")" 2>/dev/null || true)"
    [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

stop_service() {
    local name="$1" pid
    pid="$(cat "$(pid_file "$name")" 2>/dev/null || true)"
    [ -n "$pid" ] || return 0

    if kill -0 "$pid" 2>/dev/null; then
        kill "$pid" 2>/dev/null || true
        # Give it a moment to close the SQLite handle before forcing.
        for _ in 1 2 3 4 5 6 7 8 9 10; do
            kill -0 "$pid" 2>/dev/null || break
            sleep 0.5
        done
        kill -9 "$pid" 2>/dev/null || true
        ok "Stopped $name (pid $pid)"
    fi
    rm -f "$(pid_file "$name")"
}

start_service() {
    local name="$1"; shift
    if running "$name"; then
        warn "$name already running (pid $(cat "$(pid_file "$name")"))"
        return 0
    fi
    mkdir -p "$RUN_DIR"
    "$@" >> "$(log_file "$name")" 2>&1 &
    echo $! > "$(pid_file "$name")"
    ok "Started $name (pid $(cat "$(pid_file "$name")")) — logs: .run/${name}.log"
}

require_pnpm() {
    have pnpm && return 0
    have corepack || die "pnpm is required. Install Node 24+ (which ships corepack) then run: corepack enable"
    corepack enable >/dev/null 2>&1 || true
    have pnpm || die "pnpm not found after 'corepack enable'. Install it with: npm i -g pnpm"
}

install_deps() {
    require_pnpm
    log "Installing dependencies (pnpm)"
    pnpm install
}

build_console() {
    require_pnpm
    log "Building the console bundle"
    pnpm --filter atalaia-console run build
}

up_local() {
    require_pnpm
    [ "$SKIP_INSTALL" = "1" ] || install_deps

    mkdir -p "$RUN_DIR" "$ROOT/data"

    if [ "$DEV" = "1" ]; then
        start_service api pnpm run dev
    else
        start_service api node src/interface/index.js
    fi
    wait_http "http://localhost:$(API_PORT)/health" "API" 60 || dim "See .run/api.log"

    if [ "$WITH_CONSOLE" = "1" ]; then
        if [ ! -d "$ROOT/ui/dist" ] || [ "$REBUILD" = "1" ]; then
            build_console
        fi

        local api_url
        api_url="$(env_get ATALAIA_API_URL)"
        [ -n "$api_url" ] || api_url="http://localhost:$(API_PORT)"

        # The console server reads plain process env, so the values it needs are
        # passed explicitly rather than relying on dotenv.
        start_service console env \
            NODE_ENV="${NODE_ENV:-production}" \
            API_KEY="$(env_get API_KEY)" \
            UI_PASSWORD="$(env_get UI_PASSWORD)" \
            UI_SESSION_SECRET="$(env_get UI_SESSION_SECRET)" \
            UI_PORT="$(UI_PORT_)" \
            ATALAIA_API_URL="$api_url" \
            node ui/server/index.js

        wait_http "http://localhost:$(UI_PORT_)/healthz" "Console" 60 || dim "See .run/console.log"
    fi

    summary
}

down_local() {
    stop_service console
    stop_service api
}

# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------

summary() {
    echo
    printf '  API      http://localhost:%s        (health: /health)\n' "$(API_PORT)"
    [ "$WITH_CONSOLE" = "1" ] && \
    printf '  Console  http://localhost:%s        (password: UI_PASSWORD in .env)\n' "$(UI_PORT_)"
    printf '  Logs     %s\n' "$([ "$MODE" = docker ] && echo 'docker compose logs -f' || echo './scripts/atalaia.sh logs')"
    echo
}

cmd_up() {
    ensure_env
    for key in API_KEY UI_SESSION_SECRET; do
        is_placeholder "$(env_get "$key")" && die "$key is not configured in .env"
    done
    if [ "$MODE" = docker ]; then up_docker; else up_local; fi
}

cmd_down() {
    case "$MODE" in
        docker) down_docker ;;
        local)  down_local ;;
        *)      down_local; down_docker ;;
    esac
}

cmd_status() {
    local api_url="http://localhost:$(API_PORT)/health"
    local ui_url="http://localhost:$(UI_PORT_)/healthz"

    if curl -fsS --max-time 3 "$api_url" 2>/dev/null; then echo; else warn "API not responding on $api_url"; fi
    if curl -fsS --max-time 3 "$ui_url" 2>/dev/null; then echo; else warn "Console not responding on $ui_url"; fi

    if docker_ready && [ -n "$(compose ps -q 2>/dev/null)" ]; then
        echo
        compose ps
    fi
    for name in api console; do
        running "$name" && dim "local $name running (pid $(cat "$(pid_file "$name")"))"
    done
    return 0
}

cmd_logs() {
    local which="${1:-all}"
    if [ "$MODE" = docker ] || { [ "$MODE" = auto ] && docker_ready && [ -n "$(compose ps -q 2>/dev/null)" ]; }; then
        compose logs -f
        return
    fi
    case "$which" in
        api)     tail -f "$(log_file api)" ;;
        console) tail -f "$(log_file console)" ;;
        *)       tail -f "$RUN_DIR"/*.log ;;
    esac
}

cmd_doctor() {
    log "Environment"
    have node   && dim "node    $(node -v)"            || warn "node is not installed (Node 24+ required)"
    have pnpm   && dim "pnpm    $(pnpm -v)"            || warn "pnpm is not installed — run: corepack enable"
    docker_ready && dim "docker  $(docker --version)"  || warn "Docker is not available (local mode still works)"
    have curl   || warn "curl is not installed — health checks will be skipped"

    log "Configuration"
    if [ -f "$ENV_FILE" ]; then
        dim ".env     present"
        for key in API_KEY UI_PASSWORD UI_SESSION_SECRET; do
            if is_placeholder "$(env_get "$key")"; then
                warn "$key is unset or still a placeholder — run: $0 init"
            else
                dim "$key set"
            fi
        done
        [ -n "$(env_get SLACK_WEBHOOK_URL)" ] || dim "SLACK_WEBHOOK_URL not set — Slack alerts disabled"
    else
        warn ".env is missing — run: $0 init"
    fi

    [ -d "$ROOT/ui/dist" ] && dim "console  bundle built" || dim "console  bundle not built (built on first 'up')"
    return 0
}

usage() {
    cat <<'EOF'
Atalaia launcher — start the API and the management console.

Usage: ./scripts/atalaia.sh <command> [options]

Commands:
  up                 Start everything. Uses Docker when the daemon is running,
                     otherwise falls back to local Node processes.
  down               Stop everything this script started.
  restart            down + up.
  status             Health of both services, plus what is currently running.
  logs [api|console] Follow logs (docker compose logs when running in Docker).
  init               Create .env from .env.example and generate missing secrets.
  install            Install dependencies with pnpm.
  build              Build the console bundle and the CLI.
  test               Run the test suite.
  doctor             Check prerequisites and configuration.

Options:
  --docker           Force Docker mode.
  --local            Force local mode (no Docker).
  --dev              Local mode with hot-reload (nodemon).
  --build            Rebuild images / the console bundle before starting.
  --no-console       Start the API only.
  --skip-install     Local mode: do not run `pnpm install`.
  -h, --help         Show this help.

Examples:
  ./scripts/atalaia.sh up                 # whatever is available on this machine
  ./scripts/atalaia.sh up --docker --build
  ./scripts/atalaia.sh up --local --dev   # hot-reload API, console on :3001
  ./scripts/atalaia.sh logs api
  ./scripts/atalaia.sh down
EOF
}

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------

MODE=auto
DEV=0
REBUILD=0
WITH_CONSOLE=1
SKIP_INSTALL=0
COMMAND=""
LOG_TARGET=all

while [ $# -gt 0 ]; do
    case "$1" in
        --docker)       MODE=docker ;;
        --local)        MODE=local ;;
        --dev)          DEV=1; MODE=local ;;
        --build)        REBUILD=1 ;;
        --no-console)   WITH_CONSOLE=0 ;;
        --skip-install) SKIP_INSTALL=1 ;;
        -h|--help)      usage; exit 0 ;;
        -*)             die "Unknown option: $1 (try --help)" ;;
        *)              if [ -z "$COMMAND" ]; then COMMAND="$1"; else LOG_TARGET="$1"; fi ;;
    esac
    shift
done

COMMAND="${COMMAND:-up}"

# `up` needs a concrete mode; the other commands can stay mode-agnostic.
if [ "$MODE" = auto ] && [ "$COMMAND" = up ]; then
    if docker_ready; then MODE=docker; else MODE=local; fi
    dim "mode: $MODE"
fi

case "$COMMAND" in
    up)      cmd_up ;;
    down)    cmd_down ;;
    restart) cmd_down; if [ "$MODE" = auto ]; then docker_ready && MODE=docker || MODE=local; fi; cmd_up ;;
    status)  cmd_status ;;
    logs)    cmd_logs "$LOG_TARGET" ;;
    init)    ensure_env ;;
    install) install_deps ;;
    build)   install_deps; build_console; require_pnpm; pnpm run build:cli ;;
    test)    require_pnpm; pnpm test ;;
    doctor)  cmd_doctor ;;
    help)    usage ;;
    *)       usage; die "Unknown command: $COMMAND" ;;
esac
