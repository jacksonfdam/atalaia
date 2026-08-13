# Stage 1: Builder - Install production dependencies
FROM node:24-alpine AS builder
WORKDIR /app

# better-sqlite3 has no musl prebuilds, so it is compiled from source here
RUN apk add --no-cache python3 make g++

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY scripts ./scripts
# pnpm is the source of truth: the lockfile carries the security overrides.
# Lifecycle scripts are skipped (the `prepare` hook builds the CLI and needs
# devDependencies); better-sqlite3 is rebuilt explicitly for its native binding.
RUN corepack enable \
 && pnpm install --prod --frozen-lockfile --ignore-scripts \
 && pnpm rebuild better-sqlite3

# Stage 2: Production image
FROM node:24-alpine
WORKDIR /app

# Copy dependencies from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy application code
COPY src ./src
COPY db ./db
COPY config.json ./config.json
COPY config ./config

# Create data directory for SQLite database
RUN mkdir -p /app/data

EXPOSE 3000

# Health check against /health endpoint. Shell form so a custom $PORT is honoured.
HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=10s \
  CMD wget -qO- "http://127.0.0.1:${PORT:-3000}/health" || exit 1

CMD ["node", "src/interface/index.js"]
