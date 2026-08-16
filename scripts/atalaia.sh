#!/usr/bin/env bash
#
# Atalaia launcher — brings up the API, the worker and the management console.
#
# Containers only. The three services need the same secrets and the console
# server does not read .env on its own, so something has to wire that up; this
# script is that something, for either container runtime.
#
#   ./scripts/atalaia.sh up               # Docker if it answers, else Apple container
#   ./scripts/atalaia.sh up --docker      # force docker compose
#   ./scripts/atalaia.sh up --container   # force Apple's container CLI
#   ./scripts/atalaia.sh --help
#
# Postgres is not one of these services: it is Supabase, local (`supabase
# start`) or cloud, reached through DATABASE_URL.
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# ATALAIA_ENV_FILE exists so the bootstrap can be exercised without touching the
# real .env; everything else should leave it unset.
ENV_FILE="${ATALAIA_ENV_FILE:-$ROOT/.env}"
ENV_EXAMPLE="$ROOT/.env.example"
NETWORK="atalaia"

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

# Read a key from .env.example, commented lines included — a documented
# placeholder is what we compare a real .env against.
example_get() {
    [ -f "$ENV_EXAMPLE" ] || return 0
    awk -v key="$1" '
        {
            line = $0
            sub(/^[[:space:]]*#[[:space:]]*/, "", line)
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
    ' "$ENV_EXAMPLE" | tail -n 1
}

# Every key .env assigns a non-empty value to.
env_keys() {
    [ -f "$ENV_FILE" ] || return 0
    awk '
        /^[[:space:]]*#/ { next }
        {
            line = $0
            sub(/^[[:space:]]*(export[[:space:]]+)?/, "", line)
            eq = index(line, "=")
            if (eq == 0) next
            k = substr(line, 1, eq - 1)
            v = substr(line, eq + 1)
            sub(/[[:space:]]+$/, "", k)
            sub(/^[[:space:]]+/, "", v)
            if (v == "") next
            print k
        }
    ' "$ENV_FILE" | sort -u
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

DATABASE_URL_() {
    local url="${DATABASE_URL:-}"
    [ -n "$url" ] || url="$(env_get DATABASE_URL)"
    printf '%s' "$url"
}

# The same URL, as a container has to see it.
#
# A local Supabase is on the host, so .env says 127.0.0.1 — which is what the
# CLI, the tests and `doctor` need. Inside a container that address is the
# container itself, and the connection is refused. Rather than asking for two
# connection strings that must be kept in step, the loopback host is translated
# here, once, on the way in.
#
# A remote database is left alone: its host is on the network already.
container_database_url() {
    local url; url="$(DATABASE_URL_)"

    case "$url" in
        *@127.0.0.1:*|*@localhost:*|*@0.0.0.0:*|*@[::1]:*)
            printf '%s' "$url" | sed -E 's#@(127\.0\.0\.1|localhost|0\.0\.0\.0|\[::1\]):#@host.docker.internal:#'
            ;;
        *)
            printf '%s' "$url"
            ;;
    esac
}

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
# The services
#
# One table, two runtimes. docker compose reads docker-compose.yml and Apple's
# container CLI has no compose at all, so without a single source both would
# drift — and the drift would only show up as "it works on Docker".
#
#   name | image tag | dockerfile | entry command | port variable | health path
# ---------------------------------------------------------------------------

SERVICES="\
atalaia|atalaia-api|Dockerfile|node src/interface/index.js|PORT|/health
atalaia-worker|atalaia-worker|Dockerfile|node src/interface/worker.js||
atalaia-console|atalaia-console|ui/Dockerfile|node server/index.js|UI_PORT|/healthz"

service_field() {
    printf '%s\n' "$SERVICES" | awk -F'|' -v want="$1" -v field="$2" '$1 == want { print $field }'
}

service_names() { printf '%s\n' "$SERVICES" | cut -d'|' -f1; }

service_port() {
    case "$(service_field "$1" 5)" in
        PORT)    API_PORT ;;
        UI_PORT) UI_PORT_ ;;
        *)       printf '' ;;
    esac
}

# ---------------------------------------------------------------------------
# Runtime: Docker Compose
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
    log "Starting services with Docker Compose"

    # DATABASE_URL is interpolated into the compose file, so it has to be in the
    # environment of the compose command itself, not only in .env.
    DATABASE_URL="$(container_database_url)" \
    PORT="$(API_PORT)" UI_PORT="$(UI_PORT_)" \
        compose up -d ${REBUILD:+--build} $(services_to_start)
}

down_docker() {
    docker_ready || return 0
    log "Stopping Docker services"
    DATABASE_URL="$(container_database_url)" compose down
}

# ---------------------------------------------------------------------------
# Runtime: Apple container
#
# No compose here: each container is started by hand, on a network created for
# them, and `depends_on: healthy` becomes "poll the health endpoint before
# starting the next one".
# ---------------------------------------------------------------------------

container_ready() { have container && container system status >/dev/null 2>&1; }

container_env_args() {
    local key value
    for key in $(env_keys); do
        # DATABASE_URL is appended below, translated for a container.
        [ "$key" = "DATABASE_URL" ] && continue
        value="$(env_get "$key")"
        printf ' --env %s=%s' "$key" "$value"
    done
    printf ' --env NODE_ENV=production'
    printf ' --env DATABASE_URL=%s' "$(container_database_url)"
}

up_container() {
    container_ready || die "Apple's container service is not running. Start it with: container system start"

    log "Starting services with Apple container"
    container network create "$NETWORK" >/dev/null 2>&1 || true

    local name image dockerfile command port health
    for name in $(services_to_start); do
        image="$(service_field "$name" 2)"
        dockerfile="$(service_field "$name" 3)"
        command="$(service_field "$name" 4)"
        port="$(service_port "$name")"
        health="$(service_field "$name" 6)"

        if [ "$REBUILD" = "1" ] || ! container images list 2>/dev/null | grep -q "^$image "; then
            log "Building $image"
            container build --tag "$image" --file "$dockerfile" .
        fi

        container stop "$name" >/dev/null 2>&1 || true
        container rm "$name" >/dev/null 2>&1 || true

        local publish=""
        [ -n "$port" ] && publish="--publish ${port}:${port}"

        # The console reaches the API by container name on the shared network,
        # which is what ATALAIA_API_URL has to say — localhost inside a
        # container is the container itself.
        local extra=""
        [ "$name" = "atalaia-console" ] && extra="--env ATALAIA_API_URL=http://atalaia:$(API_PORT)"

        # shellcheck disable=SC2086
        container run --detach --name "$name" --network "$NETWORK" \
            $publish $(container_env_args) $extra "$image" $command >/dev/null

        ok "Started $name"

        # Stand in for depends_on: service_healthy.
        [ -n "$health" ] && [ -n "$port" ] && \
            wait_http "http://localhost:${port}${health}" "$name" 120 || true
    done
}

down_container() {
    container_ready || return 0
    log "Stopping Apple container services"

    local name
    for name in $(service_names); do
        container stop "$name" >/dev/null 2>&1 || true
        container rm "$name" >/dev/null 2>&1 || true
    done
    container network delete "$NETWORK" >/dev/null 2>&1 || true
}

# ---------------------------------------------------------------------------
# Runtime selection
# ---------------------------------------------------------------------------

resolve_runtime() {
    case "$MODE" in
        docker)    docker_ready || die "Docker is not running. Start Docker Desktop, or use: $0 up --container"
                   printf 'docker' ;;
        container) printf 'container' ;;
        *)         if docker_ready; then printf 'docker'
                   elif container_ready; then printf 'container'
                   else die "No container runtime available. Start Docker Desktop, or install Apple's container CLI."
                   fi ;;
    esac
}

services_to_start() {
    if [ "$WITH_CONSOLE" = "1" ]; then
        service_names
    else
        service_names | grep -v atalaia-console
    fi
}

# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------

# The address Slack and Telegram were given, which only the running API knows:
# on a tunnel the hostname is handed out at boot and differs every restart.
callback_line() {
    local key body url source provider
    key="$(env_get API_KEY)"
    [ -n "$key" ] || return 0

    # A tunnel takes a few seconds longer than /health, and the API says so
    # while it waits, so "not yet" is waited out rather than reported as "none".
    local waited=0
    while [ "$waited" -lt 45 ]; do
        body="$(curl -fsS --max-time 5 -H "X-API-Key: $key" \
            "http://localhost:$(API_PORT)/api/v1/callbacks" 2>/dev/null)" || return 0

        case "$body" in
            *'"reason":"Opening the tunnel"'*) sleep 1; waited=$((waited + 1)) ;;
            *) break ;;
        esac
    done

    # Field by field with sed rather than a JSON parser: this script may not have
    # one, and three strings do not justify requiring one.
    url="$(printf '%s' "$body" | sed -n 's/.*"url":"\([^"]*\)".*/\1/p')"
    source="$(printf '%s' "$body" | sed -n 's/.*"source":"\([^"]*\)".*/\1/p')"
    provider="$(printf '%s' "$body" | sed -n 's/.*"provider":"\([^"]*\)".*/\1/p')"

    if [ -n "$url" ]; then
        if [ "$source" = "tunnel" ]; then
            printf '  Public   %s        (%s tunnel — new address on every restart)\n' "$url" "$provider"
        else
            printf '  Public   %s        (PUBLIC_URL)\n' "$url"
        fi
    else
        printf '  Public   none         (set PUBLIC_URL or TUNNEL_PROVIDER, or chat buttons cannot reach you)\n'
    fi
}

summary() {
    echo
    printf '  API      http://localhost:%s        (health: /health)\n' "$(API_PORT)"
    [ "$WITH_CONSOLE" = "1" ] && \
    printf '  Console  http://localhost:%s        (password: UI_PASSWORD in .env)\n' "$(UI_PORT_)"
    printf '  Worker   no port; it takes jobs off the queue\n'
    callback_line
    printf '  Logs     %s logs\n' "$0"
    echo
}

cmd_up() {
    ensure_env

    for key in API_KEY UI_SESSION_SECRET; do
        is_placeholder "$(env_get "$key")" && die "$key is not configured in .env"
    done

    [ -n "$(DATABASE_URL_)" ] || die "DATABASE_URL is not set. Point it at Supabase — 'supabase start' locally, or your project's session connection string."

    case "$(resolve_runtime)" in
        docker)    up_docker ;;
        container) up_container ;;
    esac

    wait_http "http://localhost:$(API_PORT)/health" "API" 120 || true
    [ "$WITH_CONSOLE" = "1" ] && wait_http "http://localhost:$(UI_PORT_)/healthz" "Console" 120 || true
    summary
}

cmd_down() {
    case "$MODE" in
        docker)    down_docker ;;
        container) down_container ;;
        *)         down_docker; down_container ;;
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

    if container_ready; then
        local listed
        listed="$(container ls 2>/dev/null | grep -E 'atalaia' || true)"
        [ -n "$listed" ] && { echo; printf '%s\n' "$listed"; }
    fi

    return 0
}

cmd_logs() {
    local which="${1:-}"

    if docker_ready && [ -n "$(compose ps -q 2>/dev/null)" ]; then
        if [ -n "$which" ]; then compose logs -f "$which"; else compose logs -f; fi
        return
    fi

    if container_ready; then
        container logs --follow "${which:-atalaia}"
        return
    fi

    die "Nothing is running."
}

cmd_doctor() {
    log "Environment"
    have node   && dim "node      $(node -v)"           || warn "node is not installed (Node 24+ required)"
    have pnpm   && dim "pnpm      $(pnpm -v)"           || warn "pnpm is not installed — run: corepack enable"
    docker_ready    && dim "docker    $(docker --version)" || dim "docker    not available"
    container_ready && dim "container Apple container service running" || dim "container not available"
    docker_ready || container_ready || warn "No container runtime — Atalaia only runs in containers"
    have curl   || warn "curl is not installed — health checks will be skipped"
    have supabase && dim "supabase  $(supabase --version 2>/dev/null | head -1)" || dim "supabase  CLI not installed (only needed for a local database)"

    log "Database"
    local url; url="$(DATABASE_URL_)"
    if [ -z "$url" ]; then
        warn "DATABASE_URL is not set — run 'supabase start' and point it at the local stack, or use your project's connection string"
    else
        case "$url" in
            *:6543/*)
                warn "DATABASE_URL uses port 6543, Supabase's transaction pooler. Use the session connection on 5432: pgbouncer in transaction mode breaks prepared statements and LISTEN, which the queue needs." ;;
            *) dim "DATABASE_URL set" ;;
        esac

        if [ "$url" != "$(container_database_url)" ]; then
            dim "Containers will use $(container_database_url | sed -E 's#://[^@]*@#://…@#')"
        fi

        if have node; then
            if DATABASE_URL="$url" node -e "
                const { Client } = require('pg');
                const c = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 4000 });
                c.connect().then(() => c.end()).then(() => process.exit(0)).catch(() => process.exit(1));
            " 2>/dev/null; then
                ok "Postgres answered"
            else
                warn "Could not connect to DATABASE_URL"
            fi
        fi
    fi

    log "Configuration"
    if [ -f "$ENV_FILE" ]; then
        dim ".env      present"
        for key in API_KEY UI_PASSWORD UI_SESSION_SECRET; do
            if is_placeholder "$(env_get "$key")"; then
                warn "$key is unset or still a placeholder — run: $0 init"
            else
                dim "$key set"
            fi
        done
        [ -n "$(env_get SLACK_WEBHOOK_URL)" ] || dim "SLACK_WEBHOOK_URL not set — Slack alerts disabled"

        # A value copied straight out of .env.example is not configuration, but
        # the API cannot know that: the environment beats the console, so a
        # placeholder webhook or SMTP host greys out its console section and
        # fails every "Send test" against it. Compare and say so.
        local leftovers=0 key value
        for key in $(env_keys); do
            value="$(env_get "$key")"
            [ -n "$value" ] || continue
            [ "$value" = "$(example_get "$key")" ] || continue
            case "$key" in
                API_KEY|UI_PASSWORD|UI_SESSION_SECRET) continue ;;  # reported above
                PORT|NODE_ENV|LOG_LEVEL|DATABASE_URL|CRON_SCHEDULE|WEEKLY_REPORT_CRON|CORS_ORIGINS) continue ;;
                # These are the keys that pin a whole integration on their own.
                SLACK_WEBHOOK_URL|SLACK_SIGNING_SECRET|SLACK_APP_TOKEN|SLACK_APP_ID|SLACK_ENABLED|\
                TEAMS_WEBHOOK_URL|TEAMS_ENABLED|SMTP_HOST|LLM_PROVIDER)
                    warn "$key is still the .env.example placeholder — it pins the integration, so its console section is read-only and Send test fails against it"
                    ;;
                *)
                    dim "$key is still the .env.example placeholder"
                    ;;
            esac
            leftovers=$((leftovers + 1))
        done
        [ "$leftovers" -eq 0 ] || dim "Comment those out (or give them real values) to configure them from the console instead"
    else
        warn ".env is missing — run: $0 init"
    fi

    return 0
}

require_pnpm() {
    have pnpm && return 0
    have corepack || die "pnpm is required. Install Node 24+ (which ships corepack) then run: corepack enable"
    corepack enable >/dev/null 2>&1 || true
    have pnpm || die "pnpm not found after 'corepack enable'. Install it with: npm i -g pnpm"
}

usage() {
    cat <<'EOF'
Atalaia launcher — start the API, the worker and the management console.

Usage: ./scripts/atalaia.sh <command> [options]

Atalaia runs in containers. Postgres is not one of them: it is Supabase, local
(`supabase start`) or a cloud project, reached through DATABASE_URL.

Commands:
  up                 Start everything. Docker if it answers, else Apple container.
  down               Stop everything this script started.
  restart            down + up.
  status             Health of each service, plus what is currently running.
  logs [service]     Follow logs. Service names: atalaia, atalaia-worker,
                     atalaia-console.
  init               Create .env from .env.example and generate missing secrets.
  install            Install dependencies with pnpm (for developing, not running).
  build              Build the console bundle and the CLI.
  test               Run the test suite.
  doctor             Check the runtime, the database and the configuration.

Options:
  --docker           Force Docker Compose.
  --container        Force Apple's container CLI.
  --build            Rebuild images before starting.
  --no-console       Start the API and the worker only.
  -h, --help         This.

Examples:
  ./scripts/atalaia.sh up --build
  ./scripts/atalaia.sh logs atalaia-worker
  ./scripts/atalaia.sh doctor
EOF
}

# ---------------------------------------------------------------------------
# Arguments
# ---------------------------------------------------------------------------

COMMAND=""
MODE="auto"
REBUILD="0"
WITH_CONSOLE="1"
ARGS=()

while [ $# -gt 0 ]; do
    case "$1" in
        --docker)     MODE="docker" ;;
        --container)  MODE="container" ;;
        --build)      REBUILD="1" ;;
        --no-console) WITH_CONSOLE="0" ;;
        -h|--help)    usage; exit 0 ;;
        -*)           die "Unknown option: $1" ;;
        *)            if [ -z "$COMMAND" ]; then COMMAND="$1"; else ARGS+=("$1"); fi ;;
    esac
    shift
done

case "$COMMAND" in
    up)      cmd_up ;;
    down)    cmd_down ;;
    restart) cmd_down; cmd_up ;;
    status)  cmd_status ;;
    logs)    cmd_logs "${ARGS[0]:-}" ;;
    init)    ensure_env ;;
    install) require_pnpm; pnpm install ;;
    build)   require_pnpm; pnpm --filter atalaia-console run build; pnpm run build:cli ;;
    test)    require_pnpm; pnpm test ;;
    doctor)  cmd_doctor ;;
    ""|help) usage ;;
    *)       die "Unknown command: $COMMAND (try --help)" ;;
esac
