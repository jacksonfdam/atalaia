# Deployment Guide

Complete guide for deploying Atalaia to production, including port configuration, environment setup, and security considerations.

---

## Table of Contents

1. [Port Configuration](#port-configuration)
2. [Environment Setup](#environment-setup)
3. [Docker Deployment](#docker-deployment)
4. [Production Checklist](#production-checklist)
5. [Monitoring & Health](#monitoring--health)
6. [Troubleshooting](#troubleshooting)

---

## Host & Port Configuration

### Default Values

- **Default Host:** `0.0.0.0` (all interfaces)
- **Default Port:** `3000`
- **Configured in:** Code (`src/interface/index.js`)
- **Override via:** `HOST` and `PORT` environment variables

### Setting Custom Host & Port

**In `.env` file:**
```bash
HOST=0.0.0.0          # Listen on all interfaces (default)
PORT=8080             # Listen on port 8080
```

**Alternative Host Options:**
```bash
HOST=localhost        # Only local connections
HOST=127.0.0.1        # Only localhost (IPv4)
HOST=192.168.1.100    # Specific local IP
HOST=0.0.0.0          # All interfaces (Docker/external access)
```

**Docker (update `docker-compose.yml`):**
```yaml
services:
  atalaia:
    ports:
      - "8080:3000"  # Host:Container
    environment:
      - PORT=3000    # Container port
      - HOST=0.0.0.0 # Listen on all interfaces
```

**Docker with Custom Ports:**
```yaml
services:
  atalaia:
    ports:
      - "8080:8080"  # Host:Container (both custom)
    environment:
      - PORT=8080
      - HOST=0.0.0.0
```

### Common Port Mappings

| Use Case | Host Port | Container Port | Notes |
|----------|-----------|-----------------|-------|
| Local development | 3000 | 3000 | Default |
| Multiple instances | 8000, 8001, 8002 | 3000 | Each gets unique host port |
| Production behind proxy | Proxy handles | 3000 | Internal only |
| Kubernetes | Service port | 3000 | ClusterIP exposes |

---

## Environment Setup

### Required Environment Variables

```bash
# Server Configuration
HOST=0.0.0.0                    # Hostname/IP to bind to
PORT=3000                       # Port to listen on
NODE_ENV=production

# Security
API_KEY=your-secure-random-key-here
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL
SLACK_SIGNING_SECRET=your-slack-signing-secret

# Database
DB_PATH=/app/data/atalaia.db

# Email Configuration (choose one)
EMAIL_SERVICE=sendgrid
SENDGRID_API_KEY=your-sendgrid-api-key

# Optional: LLM Explanations
LLM_PROVIDER=openai
OPENAI_API_KEY=your-openai-api-key
```

### Optional Environment Variables

```bash
# Logging
LOG_LEVEL=info

# CORS (comma-separated origins)
CORS_ORIGINS=https://yourapp.com,https://www.yourapp.com

# Cron Schedules (cron format)
CRON_SCHEDULE=*/30 * * * *
WEEKLY_REPORT_CRON=0 9 * * 1

# Email (if using SMTP)
EMAIL_SERVICE=smtp
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=your-email@example.com
SMTP_PASS=your-smtp-password

# Email recipients (comma-separated)
EMAIL_RECIPIENTS=security@example.com,team@example.com
EMAIL_FROM=atalaia-alerts@example.com

# Mailtrap (testing)
EMAIL_SERVICE=mailtrap
MAILTRAP_SMTP_HOST=smtp.mailtrap.io
MAILTRAP_SMTP_PORT=2525
MAILTRAP_USER=your-mailtrap-user
MAILTRAP_PASS=your-mailtrap-pass
```

### .env.example

Create `.env.example` for team reference (never commit secrets):

```bash
# Server Configuration
PORT=3000
NODE_ENV=production

# Security (REQUIRED)
API_KEY=generate-strong-random-key
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL
SLACK_SIGNING_SECRET=your-slack-signing-secret

# Database
DB_PATH=data/atalaia.db

# Email Service (choose one: smtp, mailtrap, sendgrid)
EMAIL_SERVICE=sendgrid
SENDGRID_API_KEY=your-sendgrid-api-key
EMAIL_FROM=alerts@example.com
EMAIL_RECIPIENTS=security@example.com

# LLM (optional, for explanations)
LLM_PROVIDER=openai
OPENAI_API_KEY=your-api-key

# Advanced
LOG_LEVEL=info
CORS_ORIGINS=https://yourapp.com
CRON_SCHEDULE=*/30 * * * *
WEEKLY_REPORT_CRON=0 9 * * 1
```

### Generating Secure API Key

```bash
# Using OpenSSL
openssl rand -hex 32

# Using Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Using Python
python3 -c "import secrets; print(secrets.token_hex(32))"
```

---

## Docker Deployment

### Quick Start

```bash
# 1. Clone and enter directory
git clone <repo>
cd atalaia

# 2. Create .env from example
cp .env.example .env
# Edit .env with your values

# 3. Build and start
docker compose up -d

# 4. Verify
curl http://localhost:3000/health
```

### docker-compose.yml (Reference)

```yaml
version: '3.9'

services:
  atalaia:
    build:
      context: .
      dockerfile: Dockerfile

    # Port mapping
    ports:
      - "3000:3000"

    # Volumes
    volumes:
      - ./data:/app/data              # Database persistence

    # Configuration
    env_file:
      - .env
    environment:
      - NODE_ENV=production
      - DB_PATH=/app/data/atalaia.db

    # Restart policy
    restart: unless-stopped

    # Health check
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3000/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s

    # Resource limits (optional)
    deploy:
      resources:
        limits:
          cpus: '1'
          memory: 512M
        reservations:
          cpus: '0.5'
          memory: 256M
```

### Multi-Environment Setup

**docker-compose.override.yml** (development):
```yaml
services:
  atalaia:
    ports:
      - "3000:3000"
    environment:
      - LOG_LEVEL=debug
      - NODE_ENV=development
```

**docker-compose.prod.yml** (production):
```yaml
version: '3.9'
services:
  atalaia:
    image: myregistry/atalaia:v1.0.0
    restart: always
    environment:
      - NODE_ENV=production
      - LOG_LEVEL=warn
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 1G
```

**Run:**
```bash
# Development
docker compose up -d

# Production
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

---

## Production Checklist

### Security

- [ ] Generated strong `API_KEY` (32+ characters)
- [ ] Set `SLACK_SIGNING_SECRET` from Slack app settings
- [ ] Set `SLACK_WEBHOOK_URL` (never in git)
- [ ] Configured HTTPS/TLS at reverse proxy level
- [ ] Set `NODE_ENV=production`
- [ ] Reviewed `CORS_ORIGINS` (whitelist specific domains)
- [ ] Set up firewall rules (restrict API access)
- [ ] Database backed up regularly (`./data/`)
- [ ] Secrets stored in secure management system (not `.env` in git)

### Configuration

- [ ] `PORT` set correctly (default 3000)
- [ ] `DB_PATH` points to persistent volume
- [ ] `EMAIL_SERVICE` configured (sendgrid/mailtrap/smtp)
- [ ] Email credentials validated
- [ ] `CRON_SCHEDULE` set appropriately (not too frequent)
- [ ] `LOG_LEVEL=info` (or `warn` for quiet)
- [ ] LLM provider optional but recommended

### Monitoring

- [ ] Health check endpoint accessible (`/health`)
- [ ] Logs aggregated (CloudWatch, ELK, Datadog)
- [ ] Alerts configured for errors
- [ ] Database size monitored
- [ ] Scheduled backups in place
- [ ] Slack webhook tested

### Testing

- [ ] Health endpoint returns 200 OK
- [ ] API key authentication working
- [ ] At least one feed fetching data
- [ ] Slack notifications sent successfully
- [ ] Database is writable
- [ ] Email service working

---

## Monitoring & Health

### Health Check Endpoint

**Endpoint:** `GET /health`
**No authentication required**

```bash
curl http://localhost:3000/health
```

**Response (healthy):**
```json
{
  "status": "ok",
  "timestamp": "2026-03-09T12:34:56.789Z"
}
```

**Docker health check:**
```bash
docker compose ps
# HEALTHCHECK: healthy ✓
```

### Container Health Status

```bash
# View health status
docker inspect --format='{{.State.Health.Status}}' atalaia-atalaia-1

# View health logs
docker inspect --format='{{.State.Health}}' atalaia-atalaia-1 | jq .
```

### Log Monitoring

```bash
# View recent logs
docker compose logs --tail=50

# Follow logs (live)
docker compose logs -f

# Logs from specific service
docker compose logs -f atalaia

# Search logs
docker compose logs | grep "ERROR"
```

### Metrics to Monitor

1. **Feed Fetch Success Rate** — Look for `"Feed returned"` logs
2. **Vulnerability Count** — Check `/api/v1/stats` periodically
3. **Error Frequency** — Monitor ERROR log level
4. **Response Times** — Check API endpoint latency
5. **Database Size** — Monitor `data/atalaia.db` growth

---

## Troubleshooting

### Port Already in Use

**Error:** `Address already in use`

**Solution 1: Use different port**
```bash
PORT=8080 docker compose up -d
```

**Solution 2: Kill existing process**
```bash
# Find process on port 3000
lsof -i :3000
# Kill it
kill -9 <PID>
```

**Solution 3: Check what's using it**
```bash
netstat -tlnp | grep 3000
```

### Cannot Connect to Container

**Error:** `Connection refused`

**Solutions:**
```bash
# 1. Verify container is running
docker compose ps

# 2. Check logs for startup errors
docker compose logs atalaia

# 3. Ensure port mapping is correct
docker compose config | grep -A5 ports

# 4. Try from inside container
docker compose exec atalaia curl localhost:3000/health

# 5. Check Docker network
docker network inspect atalaia_default
```

### Health Check Failing

**Error:** `unhealthy`

```bash
# Check what's happening
docker compose logs atalaia | grep -i health

# Manual health check
curl http://localhost:3000/health -v

# If inside container only:
docker compose exec atalaia wget -qO- http://localhost:3000/health
```

### Database Issues

**Error:** `SQLITE_CANTOPEN`

**Solutions:**
```bash
# 1. Check data directory exists
ls -la ./data/

# 2. Ensure write permissions
chmod 755 ./data/

# 3. Verify volume mount
docker compose config | grep -A5 volumes

# 4. Check logs
docker compose logs atalaia | grep -i database
```

### API Key Not Working

**Error:** `Missing X-API-Key header`

```bash
# 1. Verify API_KEY is set
docker compose exec atalaia printenv API_KEY

# 2. Check .env file
cat .env | grep API_KEY

# 3. Verify header format (case-sensitive)
curl -H "X-Api-Key: $API_KEY" ...  # ❌ Wrong
curl -H "X-API-Key: $API_KEY" ...  # ✅ Correct
```

### Slack Integration Not Working

**Error:** Slack notifications not appearing

**Solutions:**
```bash
# 1. Verify webhook URL
docker compose exec atalaia printenv SLACK_WEBHOOK_URL

# 2. Test webhook manually
curl -X POST -H 'Content-type: application/json' \
  --data '{"text":"Test from Atalaia"}' \
  YOUR_WEBHOOK_URL

# 3. Check logs for errors
docker compose logs | grep -i slack

# 4. Verify signing secret if using actions
docker compose exec atalaia printenv SLACK_SIGNING_SECRET
```

### Email Not Sending

**Error:** Email service errors in logs

**For SendGrid:**
```bash
# Verify API key
docker compose exec atalaia printenv SENDGRID_API_KEY

# Test connectivity
docker compose exec atalaia \
  curl -s https://api.sendgrid.com/v3/mail/validate \
    -H "Authorization: Bearer $SENDGRID_API_KEY"
```

**For SMTP:**
```bash
# Verify credentials
docker compose exec atalaia printenv | grep SMTP

# Test connection
docker compose exec atalaia nc -zv $SMTP_HOST $SMTP_PORT
```

**For Mailtrap:**
```bash
# Verify credentials
docker compose exec atalaia printenv | grep MAILTRAP

# Check inbox at mailtrap.io
```

### Monitoring Cron Jobs

```bash
# Check if monitoring cycle is running
docker compose logs | grep "Starting vulnerability monitoring"

# Verify cron schedule
docker compose exec atalaia printenv CRON_SCHEDULE

# Check last feed fetch
docker compose logs | grep "Feed returned" | tail -1
```

---

## Performance Tuning

### Resource Limits

Adjust in `docker-compose.yml`:

```yaml
deploy:
  resources:
    limits:
      cpus: '1.5'      # Max 1.5 cores
      memory: 512M     # Max 512MB
    reservations:
      cpus: '0.5'      # Guaranteed 0.5 cores
      memory: 256M     # Guaranteed 256MB
```

### Database Optimization

```bash
# Vacuum database (clean up)
sqlite3 ./data/atalaia.db "VACUUM;"

# Check database size
du -h ./data/atalaia.db

# Backup before maintenance
cp ./data/atalaia.db ./data/atalaia.db.backup
```

### Log Level Tuning

```bash
# For quieter production logs
LOG_LEVEL=warn

# For detailed debugging
LOG_LEVEL=debug
```

---

## Backup & Recovery

### Backup Database

```bash
# Single backup
cp ./data/atalaia.db ./data/atalaia.db.$(date +%Y%m%d-%H%M%S)

# Automated daily backups (cron)
0 2 * * * cd /path/to/atalaia && cp ./data/atalaia.db ./backups/atalaia.db.$(date +\%Y\%m\%d)
```

### Restore Database

```bash
# Stop container
docker compose down

# Restore backup
cp ./data/atalaia.db.backup ./data/atalaia.db

# Restart
docker compose up -d
```

---

## Support

For deployment issues:
1. Check logs: `docker compose logs -f`
2. Verify health: `curl http://localhost:3000/health`
3. Test API: Use examples from [API.md](./API.md)
4. Review configuration: `docker compose config`
