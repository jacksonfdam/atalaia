# Stage 1: Builder — install dependencies and build the client bundle
FROM node:24-alpine AS builder
WORKDIR /app

# The workspace manifest carries the security overrides and must be present for
# --frozen-lockfile to agree with the committed lockfile.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY scripts ./scripts
COPY ui/package.json ./ui/package.json

# The root project's `prepare` hook builds the CLI and needs devDependencies
# that are irrelevant here, so lifecycle scripts are skipped.
RUN corepack enable \
 && pnpm install --frozen-lockfile --ignore-scripts --filter atalaia-console...

COPY ui ./ui
RUN pnpm --filter atalaia-console run build

# Stage 2: Runtime — server plus built assets, no build toolchain
FROM node:24-alpine
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY scripts ./scripts
COPY ui/package.json ./ui/package.json

RUN corepack enable \
 && pnpm install --prod --frozen-lockfile --ignore-scripts --filter atalaia-console...

COPY ui/server ./ui/server
COPY --from=builder /app/ui/dist ./ui/dist

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=10s \
  CMD wget -qO- "http://127.0.0.1:${UI_PORT:-3001}/healthz" || exit 1

CMD ["node", "ui/server/index.js"]
