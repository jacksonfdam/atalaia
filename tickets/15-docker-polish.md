# Ticket #15: Docker Polish

**Status:** TODO
**Verified:** ❌
**Depends On:** #14 (Test Suite)
**Blocks:** #16
**Priority:** MEDIUM

---

## Task Description

Update Docker configuration with proper health checks, compose file, and production-ready setup.

### What Needs to Be Built

1. **Updated `Dockerfile`** with health check
2. **`docker-compose.yml`** for development
3. **Verify image builds** and runs correctly

---

## Why This Matters

- **Health Checks:** Container orchestration knows app status
- **Volume Mounting:** Database persists between restarts
- **Development:** Compose simplifies local setup
- **Production Ready:** Follows best practices

---

## Acceptance Criteria

- [ ] Dockerfile based on `node:20-alpine`
- [ ] Health check endpoint: `GET /health`
- [ ] Database volume mounted at `/app/data`
- [ ] Environment file support (`.env`)
- [ ] docker-compose.yml for dev setup
- [ ] Image builds without errors
- [ ] Container starts and responds to requests
- [ ] Database persists across restarts

---

## Implementation Steps

### Step 1: Update Dockerfile

Create/update `Dockerfile`:
```dockerfile
FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy source
COPY . .

# Create data directory for database
RUN mkdir -p /app/data

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "src/interface/http/index.js"]
```

### Step 2: Create docker-compose.yml

Create `docker-compose.yml`:
```yaml
version: '3.8'

services:
  atalaia:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "3000:3000"
    volumes:
      - ./data:/app/data
      - ./.env:/app/.env:ro
    environment:
      NODE_ENV: development
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3000/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s
```

### Step 3: Build and Test

```bash
docker build -t atalaia:latest .
docker compose up -d
docker compose logs -f
# Test: curl http://localhost:3000/health
docker compose down
```

---

## Validation Conditions

### Condition 1: Dockerfile Exists and Has Health Check
```bash
test -f Dockerfile && \
grep -q "HEALTHCHECK" Dockerfile && \
grep -q "/health" Dockerfile
echo "✅ Dockerfile has health check"
```

### Condition 2: docker-compose.yml Exists
```bash
test -f docker-compose.yml && \
grep -q "atalaia\|services" docker-compose.yml
echo "✅ docker-compose.yml exists"
```

### Condition 3: Image Builds Successfully
```bash
docker build -t atalaia:test . && \
echo "✅ Docker image builds"
```

### Condition 4: Container Starts
```bash
docker run -d --name atalaia-test atalaia:test && \
sleep 3 && \
docker ps | grep atalaia-test && \
docker stop atalaia-test && \
docker rm atalaia-test
echo "✅ Container starts and runs"
```

### Condition 5: Health Check Works
```bash
docker run -d --name atalaia-health atalaia:test && \
sleep 5 && \
docker exec atalaia-health wget -qO- http://localhost:3000/health && \
docker stop atalaia-health && \
docker rm atalaia-health
echo "✅ Health check endpoint works"
```

### Condition 6: Volume Mounting Works
```bash
docker compose up -d && \
sleep 3 && \
test -d data && \
docker compose down
echo "✅ Volume mounting works"
```

---

## Proof Required

Before marking VERIFIED, provide:

1. **File existence** (Condition 1-2)
2. **Docker build output** (Condition 3)
3. **Container startup logs** (Condition 4)
4. **Health check curl output** (Condition 5)
5. **Volume verification** (Condition 6)
6. **Compose up/down logs** (Condition 6)
7. **Git diff** showing Dockerfile and docker-compose.yml

---

## Proof of Verification

_To be filled in after implementation_

```
Condition 1: [✅/❌] Dockerfile with health check
Condition 2: [✅/❌] docker-compose.yml exists
Condition 3: [✅/❌] Image builds
Condition 4: [✅/❌] Container starts
Condition 5: [✅/❌] Health check works
Condition 6: [✅/❌] Volume mounting works

Overall Status: TODO → IN_PROGRESS → VERIFIED ✅
Verified At: [timestamp]
Verified By: [name]
```

---

## Notes

- Alpine base image keeps size small
- Health check: 30s interval, 5s timeout, 3 retries
- Compose for dev; production uses Kubernetes or similar
- Volume at `/app/data` for SQLite database
