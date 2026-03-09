# Atalaia API Documentation

Complete reference for Atalaia REST API endpoints, with examples and error handling.

**Base URL:** `http://localhost:3000` (or custom `PORT` from `.env`)
**Current Version:** v1
**Authentication:** API Key (`X-API-Key` header)

---

## Table of Contents

1. [Authentication](#authentication)
2. [Status Codes](#status-codes)
3. [Endpoints](#endpoints)
4. [Error Handling](#error-handling)
5. [Rate Limiting](#rate-limiting)
6. [Examples](#examples)

---

## Authentication

### API Key Authentication

All endpoints under `/api/v1` require the `X-API-Key` header:

```bash
curl -H "X-API-Key: your-secret-key-here" http://localhost:3000/api/v1/vulnerabilities
```

**Setting the API Key:**
- Set `API_KEY` in your `.env` file
- Pass via `X-API-Key` header in requests
- Keep the key secret (don't commit to version control)

### Public Endpoints

These endpoints **do NOT require** authentication:

- `GET /health` — Health check

### Special Authentication

- `POST /api/v1/slack/actions` — Uses Slack signature verification (not API key)

---

## Status Codes

| Code | Meaning | Description |
|------|---------|-------------|
| **200** | OK | Request succeeded |
| **400** | Bad Request | Invalid input (missing fields, invalid format) |
| **401** | Unauthorized | Missing or invalid API key |
| **404** | Not Found | Resource not found (e.g., CVE not in database) |
| **500** | Server Error | Internal server error |

---

## Endpoints

### 1. Health Check

**Endpoint:** `GET /health`
**Auth:** None
**Cache:** No

Check if the server is running and healthy.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2026-03-09T12:34:56.789Z"
}
```

**Example:**
```bash
curl http://localhost:3000/health
```

---

### 2. List Vulnerabilities

**Endpoint:** `GET /api/v1/vulnerabilities`
**Auth:** API Key required
**Parameters:** Query string filters (optional)

List all vulnerabilities with optional filtering by status, severity, or source.

**Query Parameters:**

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `status` | string | Filter by status (OPEN, ACKNOWLEDGED, RESOLVED) | `?status=OPEN` |
| `severity` | string | Filter by severity (CRITICAL, HIGH, MEDIUM, LOW) | `?severity=CRITICAL` |
| `source` | string | Filter by source (nvd, cisa, snyk, vuldb, cvedetails) | `?source=cisa` |

**Response:**
```json
{
  "count": 42,
  "vulnerabilities": [
    {
      "cveId": "CVE-2024-0001",
      "title": "Critical RCE in popular framework",
      "description": "Long description...",
      "severity": "CRITICAL",
      "cvssScore": 9.8,
      "exploited": true,
      "status": "OPEN",
      "statusChangedBy": "slack:U123456",
      "statusChangedAt": "2026-03-08T10:00:00Z",
      "source": "cisa",
      "sourceUrl": "https://...",
      "affectedTechnologies": ["node.js", "react"],
      "publishedAt": "2026-03-01T00:00:00Z"
    }
  ]
}
```

**Examples:**
```bash
# All vulnerabilities
curl -H "X-API-Key: $API_KEY" http://localhost:3000/api/v1/vulnerabilities

# Only CRITICAL vulns
curl -H "X-API-Key: $API_KEY" \
  "http://localhost:3000/api/v1/vulnerabilities?severity=CRITICAL"

# Only OPEN vulns from CISA
curl -H "X-API-Key: $API_KEY" \
  "http://localhost:3000/api/v1/vulnerabilities?status=OPEN&source=cisa"
```

---

### 3. Get Vulnerability Statistics

**Endpoint:** `GET /api/v1/stats`
**Auth:** API Key required

Get aggregate counts of vulnerabilities by status, severity, and source.

**Response:**
```json
{
  "total": 150,
  "byStatus": {
    "OPEN": 85,
    "ACKNOWLEDGED": 45,
    "RESOLVED": 20
  },
  "bySeverity": {
    "CRITICAL": 12,
    "HIGH": 38,
    "MEDIUM": 60,
    "LOW": 40
  },
  "bySource": {
    "nvd": 80,
    "cisa": 45,
    "snyk": 20,
    "vuldb": 5
  }
}
```

**Example:**
```bash
curl -H "X-API-Key: $API_KEY" http://localhost:3000/api/v1/stats
```

---

### 4. Update Vulnerability Status

**Endpoint:** `PATCH /api/v1/vulnerabilities/:cveId/status`
**Auth:** API Key required
**Content-Type:** application/json

Update a vulnerability's status to ACKNOWLEDGED or RESOLVED.

**URL Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `cveId` | string | CVE identifier (e.g., CVE-2024-0001) |

**Request Body:**

```json
{
  "status": "ACKNOWLEDGED",
  "changedBy": "security-team"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `status` | string | Yes | New status: `ACKNOWLEDGED` or `RESOLVED` |
| `changedBy` | string | Yes | Who made the change (e.g., user email, team name, Slack user ID) |

**Response:**
```json
{
  "cveId": "CVE-2024-0001",
  "status": "ACKNOWLEDGED",
  "statusChangedBy": "security-team",
  "statusChangedAt": "2026-03-09T12:34:56.789Z",
  ...
}
```

**Status Transitions:**
- `OPEN` → `ACKNOWLEDGED` ✅
- `OPEN` → `RESOLVED` ✅
- `ACKNOWLEDGED` → `RESOLVED` ✅
- `RESOLVED` → Any other status ❌ (final state)

**Errors:**
```json
{
  "error": "CVE-2024-9999 not found in database"
}
```

**Examples:**
```bash
# Acknowledge a vulnerability
curl -X PATCH \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"status":"ACKNOWLEDGED","changedBy":"john@example.com"}' \
  http://localhost:3000/api/v1/vulnerabilities/CVE-2024-0001/status

# Resolve a vulnerability
curl -X PATCH \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"status":"RESOLVED","changedBy":"security-team"}' \
  http://localhost:3000/api/v1/vulnerabilities/CVE-2024-0001/status
```

---

### 5. Query by Technology

**Endpoint:** `POST /api/v1/query`
**Auth:** API Key required
**Content-Type:** application/json

Find all vulnerabilities affecting specified technologies.

**Request Body:**

```json
{
  "technologies": ["react", "node.js", "kubernetes"]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `technologies` | array | Yes | List of technology names (case-insensitive) |

**Response:**
```json
{
  "count": 15,
  "vulnerabilities": [
    {
      "cveId": "CVE-2024-0042",
      "title": "Privilege escalation in kubernetes",
      "severity": "CRITICAL",
      "affectedTechnologies": ["kubernetes", "docker"],
      ...
    }
  ]
}
```

**Example:**
```bash
curl -X POST \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"technologies":["react","node.js","docker"]}' \
  http://localhost:3000/api/v1/query
```

---

### 6. List Technology Filters

**Endpoint:** `GET /api/v1/technologies`
**Auth:** API Key required

View the current technology filter configuration.

**Response:**
```json
{
  "filters": ["react", "node.js", "express", "docker", "kubernetes"],
  "matchMode": "any"
}
```

| Field | Meaning |
|-------|---------|
| `filters` | List of technologies being monitored |
| `matchMode` | Match strategy: `any` (OR logic) or `all` (AND logic) |

**Example:**
```bash
curl -H "X-API-Key: $API_KEY" http://localhost:3000/api/v1/technologies
```

---

### 7. Update Technology Filters

**Endpoint:** `POST /api/v1/technologies`
**Auth:** API Key required
**Content-Type:** application/json

Update the technology filter list. This changes which CVEs are considered relevant.

**Request Body:**

```json
{
  "technologies": ["react", "node.js", "kubernetes", "postgresql"]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `technologies` | array | Yes | New list of technologies to monitor |

**Response:**
```json
{
  "filters": ["react", "node.js", "kubernetes", "postgresql"],
  "matchMode": "any"
}
```

**Persistence:**
- Updates are saved to `config/technologies.json`
- Changes take effect immediately for new monitoring cycles
- Does not affect already-monitored vulnerabilities

**Example:**
```bash
curl -X POST \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"technologies":["react","vue","svelte"]}' \
  http://localhost:3000/api/v1/technologies
```

---

### 8. Slack Interactive Actions

**Endpoint:** `POST /api/v1/slack/actions`
**Auth:** Slack signature verification (not API key)

Handle interactive button clicks from Slack messages (Acknowledge/Resolve buttons).

**Security:**
- Verifies Slack request signature using `SLACK_SIGNING_SECRET`
- Rejects requests without valid signature
- Timestamp verification prevents replay attacks

**Triggered by:**
- User clicks "Acknowledge" button in Slack message
- User clicks "Resolve" button in Slack message

**Example Payload (from Slack):**
```json
{
  "type": "block_actions",
  "actions": [
    {
      "type": "button",
      "action_id": "acknowledge_CVE-2024-0001",
      "value": "acknowledged"
    }
  ],
  "user": {
    "id": "U123456",
    "username": "john.doe"
  }
}
```

**Notes:**
- This endpoint is called automatically by Slack, not by users
- Requires `SLACK_SIGNING_SECRET` in `.env`

---

## Error Handling

### Error Response Format

All errors return a JSON object:

```json
{
  "error": "Human-readable error message"
}
```

### Common Error Scenarios

**Missing API Key:**
```bash
curl http://localhost:3000/api/v1/vulnerabilities
```
Response (401):
```json
{
  "error": "Missing X-API-Key header"
}
```

**Invalid Status Value:**
```bash
curl -X PATCH \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"status":"INVALID","changedBy":"user"}' \
  http://localhost:3000/api/v1/vulnerabilities/CVE-2024-0001/status
```
Response (400):
```json
{
  "error": "Invalid status: INVALID. Must be ACKNOWLEDGED or RESOLVED"
}
```

**CVE Not Found:**
```bash
curl -X PATCH \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"status":"ACKNOWLEDGED","changedBy":"user"}' \
  http://localhost:3000/api/v1/vulnerabilities/CVE-9999-9999/status
```
Response (404):
```json
{
  "error": "CVE-9999-9999 not found in database"
}
```

---

## Rate Limiting

Currently, the API does **not** enforce rate limiting. However, production deployments should consider:

- Implementing rate limiting via reverse proxy (nginx, CloudFlare)
- Using API gateway solutions
- Monitoring for abuse patterns

---

## Examples

### Complete Workflow

```bash
# 1. Check health
curl http://localhost:3000/health

# 2. Get statistics
curl -H "X-API-Key: $API_KEY" \
  http://localhost:3000/api/v1/stats

# 3. View current technology filters
curl -H "X-API-Key: $API_KEY" \
  http://localhost:3000/api/v1/technologies

# 4. Update technology filters
curl -X POST \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"technologies":["react","node.js"]}' \
  http://localhost:3000/api/v1/technologies

# 5. Query for specific technologies
curl -X POST \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"technologies":["react"]}' \
  http://localhost:3000/api/v1/query

# 6. List only critical vulns
curl -H "X-API-Key: $API_KEY" \
  "http://localhost:3000/api/v1/vulnerabilities?severity=CRITICAL&status=OPEN"

# 7. Acknowledge a vulnerability
curl -X PATCH \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"status":"ACKNOWLEDGED","changedBy":"security-team"}' \
  http://localhost:3000/api/v1/vulnerabilities/CVE-2024-0001/status
```

### Using with Environment Variables

```bash
# Set your API key
export API_KEY="your-secret-api-key"
export BASE_URL="http://localhost:3000"

# All vulnerabilities
curl -H "X-API-Key: $API_KEY" "$BASE_URL/api/v1/vulnerabilities"

# With jq for pretty printing
curl -s -H "X-API-Key: $API_KEY" "$BASE_URL/api/v1/stats" | jq .

# Count critical vulnerabilities
curl -s -H "X-API-Key: $API_KEY" \
  "$BASE_URL/api/v1/vulnerabilities?severity=CRITICAL" | jq '.count'
```

### Bash Script Example

```bash
#!/bin/bash

API_KEY="${ATALAIA_API_KEY:-your-key-here}"
BASE_URL="${ATALAIA_BASE_URL:-http://localhost:3000}"

# Function to get all CRITICAL open vulns
get_critical_vulns() {
  curl -s -H "X-API-Key: $API_KEY" \
    "$BASE_URL/api/v1/vulnerabilities?severity=CRITICAL&status=OPEN" | jq .
}

# Function to acknowledge a CVE
acknowledge_cve() {
  local cve=$1
  curl -s -X PATCH \
    -H "X-API-Key: $API_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"status\":\"ACKNOWLEDGED\",\"changedBy\":\"script\"}" \
    "$BASE_URL/api/v1/vulnerabilities/$cve/status"
}

get_critical_vulns
```

---

## Support

For issues or questions about the API:
1. Check this documentation
2. Review the example cURL commands
3. Check server logs: `docker compose logs`
4. Verify `.env` configuration
5. Check `X-API-Key` header is set correctly
