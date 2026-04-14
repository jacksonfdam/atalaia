# Stage 1: Builder - Install production dependencies
FROM node:24-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

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

# Health check against /health endpoint
HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=10s \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "src/interface/index.js"]
