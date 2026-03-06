

Here's the fully updated prompt, now grounded in your actual folder structure with clear migration paths and documentation instructions.

---

# Atalaia 🛡️👁️ — Full Implementation Prompt

## Context

You are an expert Node.js software engineer. You are building **Atalaia**, a real-time security vulnerability monitoring service for a software consultancy (jacksonfdam, part of jacksonfdam AB). The project has a **working prototype** with the folder structure shown below. Your job is to **migrate, harden, and extend it** following this plan.

**Do not overengineer.** Keep it simple, testable, and maintainable. Every decision should serve a real need described in this document.

---

## Current State (What Exists Today)

```
.
├── config.json              # Technology filters and basic config
├── Dockerfile               # Basic Docker setup
├── ISO-27001.md             # Compliance documentation
├── package-lock.json
├── package.json
├── project_summary.md       # Project overview doc
├── README.md                # Project readme
├── src
│   ├── application
│   │   └── monitorVulns.js  # Main orchestration logic
│   ├── domain
│   │   └── Vulnerability.js # Vulnerability DTO entity
│   ├── infrastructure
│   │   ├── cache.js         # JSON file-based cache (vuln-cache.json)
│   │   ├── config.js        # Centralized config
│   │   ├── fetchFeeds.js    # All scrapers in one file
│   │   ├── notifySlack.js   # Slack webhook integration
│   │   └── scheduler.js     # Cron job management
│   └── interface
│       └── index.js         # Express server entry point
└── vuln-cache.json          # Flat file cache (to be replaced)
```

### What Works:
- Fetches from CISA, Snyk, VulDB, CVE Details
- Normalizes to `Vulnerability` entity
- Deduplicates via `vuln-cache.json`
- Sends Slack notifications
- Runs on a cron schedule
- Has a `/health` endpoint
- Runs in Docker

### What Needs to Change:
- `vuln-cache.json` → SQLite database
- `fetchFeeds.js` (monolith) → Individual feed files with error boundaries
- No status lifecycle → OPEN / ACKNOWLEDGED / RESOLVED
- No LLM integration → Provider-agnostic client-friendly explanations
- No API → REST API for status changes, tech filters, and future scanner
- No email → Weekly email reports
- No structured logging → Pino
- Basic tests → Proper unit and integration tests
- Docs are outdated → Must be updated at every step

---

## Target State (What We're Building)

```
.
├── config
│   └── technologies.json          # MOVED from ./config.json, focused on tech filters
├── data
│   └── atalaia.db                 # NEW: SQLite database (Docker volume mounted)
├── db
│   └── migrations
│       └── 001_initial.sql        # NEW: SQLite schema
├── Dockerfile                     # UPDATED
├── docker-compose.yml             # NEW
├── ISO-27001.md                   # UPDATED with new architecture details
├── package-lock.json
├── package.json                   # UPDATED with new dependencies
├── project_summary.md             # UPDATED to reflect new architecture
├── README.md                      # UPDATED with full setup, API docs, architecture
├── .env.example                   # NEW: Template for environment variables
├── src
│   ├── application
│   │   ├── monitorVulns.js        # REFACTORED: uses dependency injection
│   │   ├── acknowledgeVuln.js     # NEW
│   │   ├── resolveVuln.js         # NEW
│   │   ├── generateWeeklyReport.js # NEW
│   │   └── queryByTech.js         # NEW: "Any CVEs for these techs?"
│   ├── domain
│   │   ├── entities
│   │   │   └── Vulnerability.js   # MOVED + UPDATED with status field
│   │   ├── enums
│   │   │   └── Status.js          # NEW: OPEN | ACKNOWLEDGED | RESOLVED
│   │   └── ports
│   │       ├── CachePort.js       # NEW: Interface for cache implementations
│   │       ├── NotifierPort.js    # NEW: Interface for notification implementations
│   │       ├── FeedPort.js        # NEW: Interface for feed implementations
│   │       └── LLMPort.js         # NEW: Interface for LLM implementations
│   ├── infrastructure
│   │   ├── feeds                  # NEW directory, replaces fetchFeeds.js
│   │   │   ├── cisaFeed.js        # EXTRACTED from fetchFeeds.js
│   │   │   ├── snykFeed.js        # EXTRACTED from fetchFeeds.js
│   │   │   ├── vuldbFeed.js       # EXTRACTED from fetchFeeds.js
│   │   │   ├── cveDetailsFeed.js  # EXTRACTED from fetchFeeds.js
│   │   │   └── nvdFeed.js         # NEW source
│   │   ├── cache
│   │   │   └── sqliteCache.js     # NEW: Replaces cache.js
│   │   ├── notifiers
│   │   │   ├── slackNotifier.js   # MOVED + REFACTORED from notifySlack.js
│   │   │   └── emailNotifier.js   # NEW
│   │   ├── llm
│   │   │   ├── llmAdapter.js      # NEW: Factory for LLM providers
│   │   │   ├── openaiProvider.js  # NEW
│   │   │   ├── ollamaProvider.js  # NEW: Local LLM support
│   │   │   └── prompts
│   │   │       └── explainCve.txt # NEW: Prompt template
│   │   ├── config.js              # UPDATED with new env vars
│   │   ├── logger.js              # NEW: Pino logger setup
│   │   └── scheduler.js           # UPDATED with additional cron jobs
│   ├── interface
│   │   ├── http
│   │   │   ├── index.js           # MOVED + REFACTORED: composition root
│   │   │   ├── healthRoutes.js    # NEW: Extracted from index.js
│   │   │   └── apiRoutes.js       # NEW: REST API
│   │   └── slack
│   │       └── slackActions.js    # NEW: Slack interactive messages handler
│   └── middleware
│       └── auth.js                # NEW: API key validation
├── tests
│   ├── unit
│   │   ├── domain
│   │   │   └── Vulnerability.test.js
│   │   └── application
│   │       ├── monitorVulns.test.js
│   │       ├── acknowledgeVuln.test.js
│   │       └── resolveVuln.test.js
│   ├── integration
│   │   ├── feeds
│   │   │   └── fixtures           # Saved HTML/JSON responses for testing
│   │   │       ├── cisa_sample.json
│   │   │       ├── snyk_sample.json
│   │   │       └── ...
│   │   ├── cache
│   │   │   └── sqliteCache.test.js
│   │   └── api
│   │       └── apiRoutes.test.js
│   └── setup.js
└── CHANGELOG.md                   # NEW: Track all changes
```

### Migration Map (Old → New):

| Old File | Action | New Location |
|---|---|---|
| `vuln-cache.json` | **DELETE** after migration | `data/atalaia.db` |
| `config.json` | **MOVE + RENAME** | `config/technologies.json` |
| `src/domain/Vulnerability.js` | **MOVE + UPDATE** | `src/domain/entities/Vulnerability.js` |
| `src/infrastructure/cache.js` | **REPLACE** | `src/infrastructure/cache/sqliteCache.js` |
| `src/infrastructure/fetchFeeds.js` | **SPLIT** into individual files | `src/infrastructure/feeds/*.js` |
| `src/infrastructure/notifySlack.js` | **MOVE + REFACTOR** | `src/infrastructure/notifiers/slackNotifier.js` |
| `src/interface/index.js` | **MOVE + REFACTOR** | `src/interface/http/index.js` |

**Important:** When moving files, update ALL import paths across the entire project. Run the app after each move to verify nothing breaks.

---

## 1. Architecture Rules (Non-Negotiable)

- **`domain/`** must have **zero** `import` statements pointing to `infrastructure/` or any npm package. Pure business logic only.
- **`application/`** depends on `domain/` only. It receives infrastructure implementations via **dependency injection** (function parameters).
- **`infrastructure/`** implements the contracts defined in `domain/ports/`.
- **`interface/`** is the **composition root** — it wires everything together. This is the only place where infrastructure meets application.
- **Never** put business logic in `infrastructure/` or `interface/`.

---

## 2. SQLite Migration

### Schema (`db/migrations/001_initial.sql`)

```sql
CREATE TABLE IF NOT EXISTS vulnerabilities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cve_id TEXT UNIQUE NOT NULL,
    title TEXT,
    description TEXT,
    severity TEXT CHECK(severity IN ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN')),
    cvss_score REAL,
    exploited INTEGER DEFAULT 0,
    source TEXT NOT NULL,
    source_url TEXT,
    affected_technologies TEXT,       -- JSON array as text: '["nginx","react"]'
    status TEXT DEFAULT 'OPEN' CHECK(status IN ('OPEN', 'ACKNOWLEDGED', 'RESOLVED')),
    status_changed_by TEXT,           -- 'slack:U12345', 'api:scanner', 'api:manual'
    status_changed_at TEXT,
    client_explanation TEXT,          -- LLM-generated plain-English explanation
    first_seen_at TEXT DEFAULT (datetime('now')),
    last_seen_at TEXT DEFAULT (datetime('now')),
    notified_at TEXT,
    resolved_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_vulns_cve ON vulnerabilities(cve_id);
CREATE INDEX idx_vulns_status ON vulnerabilities(status);
CREATE INDEX idx_vulns_severity ON vulnerabilities(severity);
CREATE INDEX idx_vulns_tech ON vulnerabilities(affected_technologies);
```

### Implementation Notes:
- Use **`better-sqlite3`** (synchronous, fast, no native compilation headaches in Docker).
- DB file lives at `./data/atalaia.db`. Docker volume: `-v ./data:/app/data`.
- Run migrations on startup in `src/interface/http/index.js` before anything else.
- Query `affected_technologies` with `json_each()` for filtering.
- **Migration from vuln-cache.json**: Write a one-time migration script that reads the existing JSON cache, inserts all entries into SQLite, then the old file can be deleted. Include this script at `db/migrate-from-json.js`.

---

## 3. Feed Pipeline (Hardened)

### Splitting `fetchFeeds.js`:
The current `src/infrastructure/fetchFeeds.js` contains all scrapers in one file. Split each source into its own file under `src/infrastructure/feeds/`. Each file must export a single async function:

```javascript
/**
 * @returns {Promise<Vulnerability[]>}
 */
export async function fetchFromCisa() { ... }
```

### Error Handling Rules:
1. **Each feed runs independently.** If one fails, the others still execute.
2. **Wrap every feed call in a try/catch** inside `monitorVulns.js`.
3. **Log failures** with feed name, error message, and timestamp using Pino.
4. **Retry once** with a 5-second delay before giving up on a feed.
5. **15-second timeout** on every HTTP request via Axios config.
6. **User-Agent header**: `Atalaia/1.0 (security-monitor; jacksonfdam@gmail.com)`.
7. **Configurable delay** between feed fetches (default: 2 seconds via `FEED_DELAY_MS`).

### Source Priority & Merge Strategy:
When the same CVE appears in multiple sources:

```javascript
const SOURCE_PRIORITY = ['nvd', 'cisa', 'snyk', 'vuldb', 'cvedetails'];

// Merge rules:
// - severity: take from highest-priority source that provides it
// - exploited: OR logic — if ANY source says exploited, mark true
// - description: take from highest-priority source
// - affected_technologies: UNION of all sources
// - source: store the highest-priority source name
```

---

## 4. Technology Filtering

### Move `config.json` → `config/technologies.json`:

```json
{
  "filters": [
    "react", "react-native", "next.js", "node.js", "typescript",
    "swift", "kotlin", "flutter", "dart",
    "postgresql", "redis", "docker", "kubernetes",
    "nginx", "aws", "gcp", "firebase",
    "graphql", "express", "fastify"
  ],
  "matchMode": "any"
}
```

- **Single source of truth** for monitored technologies.
- `matchMode: "any"` = CVE matches if it mentions ANY listed tech.
- Matching is **case-insensitive** against CVE title, description, and affected products.
- Editable without code changes. Future scanner service will update via API.

### API Endpoints (build now, scanner comes later):

```
POST /api/v1/technologies
Body: { "technologies": ["react", "svelte", "deno"] }
Response: 200 OK

GET /api/v1/technologies
Response: { "filters": [...], "matchMode": "any" }
```

---

## 5. Vulnerability Status Lifecycle

```
    ┌──────────┐
    │   OPEN   │ ← Default when first detected
    └────┬─────┘
         │
         ▼
  ┌──────────────┐
  │ ACKNOWLEDGED │ ← "We know, working on it"
  └──────┬───────┘
         │
         ▼
    ┌──────────┐
    │ RESOLVED │ ← "Fixed / mitigated / not applicable"
    └──────────┘
```

### Status Change Triggers:

**Via Slack Interactive Messages:**
- Each Slack vulnerability message includes `Acknowledge` and `Resolve` buttons.
- Button clicks hit `/api/v1/slack/actions`.
- Record who clicked: `slack:U12345`.

**Via REST API:**
```
PATCH /api/v1/vulnerabilities/:cveId/status
Body: { "status": "ACKNOWLEDGED", "changedBy": "api:scanner" }
Response: 200 OK
```

**Via Future Scanner:**
- Same PATCH endpoint with `changedBy: "api:scanner"`.

### Cleanup Policy:
- Daily cron job (configurable via `CLEANUP_CRON`).
- Delete `RESOLVED` vulnerabilities older than `CLEANUP_DAYS` (default: 30).
- **Never** auto-delete `OPEN` or `ACKNOWLEDGED` vulnerabilities.

---

## 6. LLM Integration

### Provider-Agnostic Architecture:

```javascript
// domain/ports/LLMPort.js
export class LLMPort {
  /** @param {string} prompt @returns {Promise<string>} */
  async complete(prompt) {
    throw new Error('Not implemented');
  }
}
```

```javascript
// infrastructure/llm/llmAdapter.js
export function createLLMAdapter() {
  switch (config.LLM_PROVIDER) {
    case 'openai': return new OpenAIProvider(config.OPENAI_API_KEY, config.OPENAI_MODEL);
    case 'ollama': return new OllamaProvider(config.OLLAMA_URL, config.OLLAMA_MODEL);
    default: throw new Error(`Unknown LLM provider: ${config.LLM_PROVIDER}`);
  }
}
```

### Prompt Template (`infrastructure/llm/prompts/explainCve.txt`):

```
You are a cybersecurity expert writing for a non-technical business audience.

Given the following vulnerability information, write a clear 2-3 sentence explanation that covers:
1. What the vulnerability is (in plain English)
2. What could happen if it's exploited (business impact)
3. How urgent it is to address

Vulnerability:
- CVE ID: {{cveId}}
- Title: {{title}}
- Description: {{description}}
- Severity: {{severity}} (CVSS: {{cvssScore}})
- Known Exploited: {{exploited}}
- Affected Technologies: {{technologies}}

Write in a professional but accessible tone. Avoid jargon. If the severity is CRITICAL or it's known to be exploited, make the urgency very clear.
```

### Rules:
- Generate explanation **once** when a vulnerability is first stored.
- Store in `client_explanation` column.
- If LLM is unavailable, **fall back to raw description**. Never block the pipeline.

---

## 7. Slack Notifications (Enhanced)

### Block Kit Format:

```javascript
{
  blocks: [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: exploited ? "🚨 EXPLOITED VULNERABILITY"
            : severity === 'CRITICAL' ? "🔴 CRITICAL VULNERABILITY"
            : "⚠️ New Vulnerability"
      }
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*CVE:* <${sourceUrl}|${cveId}>` },
        { type: "mrkdwn", text: `*Severity:* ${severity} (${cvssScore})` },
        { type: "mrkdwn", text: `*Technologies:* ${technologies.join(', ')}` },
        { type: "mrkdwn", text: `*Source:* ${source}` }
      ]
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: `*What this means:*\n${clientExplanation}` }
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "✅ Acknowledge" },
          action_id: "ack_vuln",
          value: cveId,
          style: "primary"
        },
        {
          type: "button",
          text: { type: "plain_text", text: "🔒 Resolve" },
          action_id: "resolve_vuln",
          value: cveId,
          style: "danger"
        }
      ]
    }
  ]
}
```

### `@channel` Rules:
- Tag `@channel` **only** when `severity === 'CRITICAL'` OR `exploited === true`.

---

## 8. Weekly Email Report

- Cron: configurable, default Monday 9:00 AM (`WEEKLY_REPORT_CRON`).
- Collects all `OPEN` and `ACKNOWLEDGED` vulnerabilities.
- Groups by severity: CRITICAL → HIGH → MEDIUM → LOW.
- Uses `client_explanation` for each entry.
- Send via **`nodemailer`** with SMTP config from `.env`.
- Recipients: `EMAIL_RECIPIENTS=jacksonfdam@gmail.com,jacksonfdam@gmail.com`.

---

## 9. REST API

All endpoints under `/api/v1/`:

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Health check (no auth) |
| `GET` | `/api/v1/vulnerabilities` | List all. Query params: `?status=OPEN&severity=CRITICAL&tech=react` |
| `GET` | `/api/v1/vulnerabilities/:cveId` | Get single vulnerability |
| `PATCH` | `/api/v1/vulnerabilities/:cveId/status` | Change status |
| `POST` | `/api/v1/technologies` | Update tech filters |
| `GET` | `/api/v1/technologies` | Get current filters |
| `POST` | `/api/v1/query` | "Any CVEs for these techs?" (for future scanner) |
| `POST` | `/api/v1/slack/actions` | Slack interactive messages endpoint |
| `GET` | `/api/v1/stats` | Counts by status, severity, source |

### Security:
- **API key middleware**: Check `X-API-Key` header against `API_KEY` in `.env`.
- **Slack endpoint**: Validate Slack signing secret instead of API key.
- `/health` is the **only** unauthenticated endpoint.

---

## 10. Configuration (`.env.example`)

```env
# Core
PORT=3000
NODE_ENV=production
API_KEY=your-secret-api-key

# Database
DB_PATH=./data/atalaia.db
CLEANUP_DAYS=30

# Scheduling
MONITOR_CRON=*/30 * * * *
CLEANUP_CRON=0 3 * * *
WEEKLY_REPORT_CRON=0 9 * * 1

# Slack
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
SLACK_SIGNING_SECRET=your-signing-secret

# Email
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=jacksonfdam@gmail.com
SMTP_PASS=your-smtp-password
EMAIL_FROM=jacksonfdam@gmail.com
EMAIL_RECIPIENTS=jacksonfdam@gmail.com,jacksonfdam@gmail.com

# LLM
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=llama3

# Feeds
FEED_DELAY_MS=2000
FEED_TIMEOUT_MS=15000
VULDB_API_KEY=

# Logging
LOG_LEVEL=info
```

---

## 11. Docker

### Dockerfile (Updated):
```dockerfile
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

RUN mkdir -p /app/data

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "src/interface/http/index.js"]
```

### docker-compose.yml (New):
```yaml
version: '3.8'
services:
  atalaia:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - ./data:/app/data
    env_file:
      - .env
    restart: unless-stopped
```

---

## 12. Logging

Use **`pino`**. Replace every `console.log` in the codebase.

```javascript
import pino from 'pino';
const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

logger.info({ feed: 'cisa', count: 12 }, 'Feed fetch completed');
logger.error({ feed: 'vuldb', err: error.message }, 'Feed fetch failed');
logger.warn({ cveId: 'CVE-2024-1234' }, 'LLM unavailable, using raw description');
```

Every log entry must include enough context to debug without guessing.

---

## 13. Testing

### Unit Tests (`tests/unit/`):
- Vulnerability entity creation and validation
- `monitorVulns` with mocked ports
- Deduplication logic
- Merge strategy for multi-source CVEs
- Status transitions
- Cleanup logic

### Integration Tests (`tests/integration/`):
- Each feed parser with **saved fixtures** (no live HTTP)
- SQLite cache operations
- API endpoints with `supertest`

### Config:
```json
{
  "scripts": {
    "test": "node --experimental-vm-modules node_modules/.bin/jest",
    "test:unit": "jest --testPathPattern=tests/unit",
    "test:integration": "jest --testPathPattern=tests/integration"
  }
}
```

Use **Jest** with ES modules support.

---

## 14. Documentation Updates

**This is mandatory. Every step must include doc updates.**

### `README.md` — Must include:
- Project overview and purpose
- Updated architecture diagram (text-based, matching the new folder structure)
- Full setup instructions (`.env`, Docker, local dev)
- API reference (all endpoints with request/response examples)
- How to add a new feed source
- How to add a new LLM provider
- How to configure technology filters
- How to run tests

### `project_summary.md` — Must include:
- Updated technical stack (add `better-sqlite3`, `pino`, `nodemailer`, etc.)
- Updated architecture description matching new folder structure
- Updated feature list
- Updated "How to Run" section

### `ISO-27001.md` — Must include:
- Updated data flow description (SQLite instead of JSON file)
- API authentication documentation (API key, Slack signing secret)
- Data retention policy (cleanup of RESOLVED vulns)
- Logging and audit trail description
- LLM data handling (what data is sent to external LLM providers)

### `CHANGELOG.md` (New) — Must include:
- Entry for every implementation step
- Format: date, version, what changed, what was migrated

### `.env.example` (New):
- Every environment variable with a comment explaining what it does
- No real secrets, only placeholder values

---

## 15. Implementation Order

Build in this exact order. **Each step must be fully working, tested, and documented before moving to the next.**

| Step | What | Key Files | Docs to Update |
|---|---|---|---|
| 1 | **SQLite migration** — Replace `vuln-cache.json` with SQLite. Write migration script for existing data. Run migrations on startup. | `db/`, `infrastructure/cache/sqliteCache.js`, `db/migrate-from-json.js` | README, project_summary, CHANGELOG |
| 2 | **Restructure domain** — Move `Vulnerability.js` into `domain/entities/`. Add `Status.js` enum. Create port interfaces. | `domain/entities/`, `domain/enums/`, `domain/ports/` | project_summary, CHANGELOG |
| 3 | **Split feeds** — Break `fetchFeeds.js` into individual files. Add error boundaries, retries, timeouts, delays. | `infrastructure/feeds/*.js` | README (how to add a feed), CHANGELOG |
| 4 | **Source priority & merge** — Implement merge strategy for duplicate CVEs. | `application/monitorVulns.js` | CHANGELOG |
| 5 | **Logging** — Add Pino. Replace all `console.log`. | `infrastructure/logger.js`, all files | CHANGELOG |
| 6 | **Status lifecycle** — Add OPEN/ACKNOWLEDGED/RESOLVED. Build PATCH endpoint. | `application/acknowledgeVuln.js`, `application/resolveVuln.js`, `interface/http/apiRoutes.js` | README (API docs), CHANGELOG |
| 7 | **Slack interactive messages** — Wire up buttons and action handler. | `interface/slack/slackActions.js`, `infrastructure/notifiers/slackNotifier.js` | README, CHANGELOG |
| 8 | **Technology config** — Move to `config/technologies.json`. Build API endpoints. | `config/technologies.json`, `interface/http/apiRoutes.js` | README, CHANGELOG |
| 9 | **API security** — Add API key middleware. Slack signing secret validation. | `middleware/auth.js` | README, ISO-27001, CHANGELOG |
| 10 | **LLM integration** — Build adapter pattern. Generate explanations. Store in DB. | `infrastructure/llm/`, `domain/ports/LLMPort.js` | README (how to add provider), ISO-27001, CHANGELOG |
| 11 | **Enhanced Slack messages** — Block Kit format with buttons and explanations. | `infrastructure/notifiers/slackNotifier.js` | CHANGELOG |
| 12 | **Weekly email** — Nodemailer + cron. Group by severity. | `application/generateWeeklyReport.js`, `infrastructure/notifiers/emailNotifier.js` | README, CHANGELOG |
| 13 | **Query endpoint** — `POST /api/v1/query` for future scanner. | `application/queryByTech.js`, `interface/http/apiRoutes.js` | README (API docs), CHANGELOG |
| 14 | **Tests** — Unit tests for domain/application. Integration tests for feeds and cache. | `tests/` | README (how to run tests), CHANGELOG |
| 15 | **Docker polish** — Updated Dockerfile, docker-compose.yml, health check. | `Dockerfile`, `docker-compose.yml` | README, CHANGELOG |
| 16 | **Final doc pass** — Review and finalize all documentation. | All `.md` files, `.env.example` | Everything |

---

## 16. What NOT to Build (Yet)

- No web dashboard. Slack + email is enough.
- No user authentication system. API key is sufficient.
- No multi-tenant support. jacksonfdam only for now.
- No repo scanner. That's a separate service. Just build the API endpoints it will call.
- No WebSocket / real-time push. Cron every 30 minutes is fine.
- No Kubernetes manifests. Single Docker container.

---

## 17. Dependencies to Add

```json
{
  "dependencies": {
    "better-sqlite3": "^11.0.0",
    "pino": "^9.0.0",
    "nodemailer": "^6.9.0"
  },
  "devDependencies": {
    "jest": "^29.0.0",
    "@jest/globals": "^29.0.0",
    "supertest": "^6.0.0",
    "pino-pretty": "^11.0.0"
  }
}
```

Keep existing dependencies (`axios`, `cheerio`, `rss-parser`, `express`, `node-cron`). Do not remove anything that's currently in use until its replacement is verified working.

---

**Start with Step 1. Show me the migration script and the new SQLite cache implementation before moving on.**