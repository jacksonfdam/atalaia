# Stage 1: Builder — production dependencies only
FROM node:24-alpine AS builder
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY scripts ./scripts
# pnpm is the source of truth: the lockfile carries the security overrides.
# Lifecycle scripts are skipped — the `prepare` hook builds the CLI and needs
# devDependencies. Nothing here compiles from source any more: better-sqlite3
# was the only native dependency, and Postgres is spoken over a socket.
RUN corepack enable \
 && pnpm install --prod --frozen-lockfile --ignore-scripts

# Stage 2: Production image
FROM node:24-alpine
WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules

# The manifest ships too. It is what declares "type": "module" and the #app/*
# import map, and it is what the MCP server reports as its version — the image
# ran without it only because Node 24 guesses ESM from the syntax.
COPY package.json ./package.json

COPY src ./src
COPY db ./db
COPY config.json ./config.json
COPY config ./config

EXPOSE 3000

# Health check against /health endpoint. Shell form so a custom $PORT is honoured.
HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=10s \
  CMD wget -qO- "http://127.0.0.1:${PORT:-3000}/health" || exit 1

# Overridden by the worker service, which runs src/interface/worker.js.
CMD ["node", "src/interface/index.js"]
