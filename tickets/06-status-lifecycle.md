# Ticket #6: Vulnerability Status Lifecycle

**Status:** TODO
**Verified:** ❌
**Depends On:** #2 (Domain Restructure), #5 (Logging)
**Blocks:** #7, #8
**Priority:** HIGH

---

## Task Description

Implement the vulnerability status lifecycle (OPEN → ACKNOWLEDGED → RESOLVED) with application use cases and REST API endpoints for status changes.

### What Needs to Be Built

1. **`src/application/acknowledgeVuln.js`** — Use case for acknowledging vulnerabilities
2. **`src/application/resolveVuln.js`** — Use case for resolving vulnerabilities
3. **`src/interface/http/apiRoutes.js`** — REST endpoints for status changes
4. **`src/interface/http/index.js`** — Refactored from monolithic interface/index.js
5. **`src/middleware/auth.js`** — API key authentication

---

## Why This Matters

- **Workflow:** Teams can track acknowledgment and resolution progress
- **Auditability:** Know who changed status and when
- **Cleanup:** Delete resolved vulns older than retention period
- **Accountability:** Slack + API can both update status

---

## Acceptance Criteria

- [ ] `acknowledgeVuln(cveId, changedBy, cache)` exists and updates status to ACKNOWLEDGED
- [ ] `resolveVuln(cveId, changedBy, cache)` exists and updates status to RESOLVED
- [ ] Both functions record `statusChangedBy` and `statusChangedAt` in DB
- [ ] Status validation: only valid transitions allowed (no RESOLVED → OPEN)
- [ ] REST endpoints exist and require API key authentication
- [ ] `PATCH /api/v1/vulnerabilities/:cveId/status` accepts body: `{ status, changedBy }`
- [ ] `GET /api/v1/vulnerabilities` supports query params: `?status=OPEN&severity=CRITICAL`
- [ ] `GET /api/v1/stats` returns counts by status, severity, source
- [ ] Logging includes who changed status and when
- [ ] Database persists all status changes

---

## Implementation Steps

### Step 1: Create Application Use Cases

`src/application/acknowledgeVuln.js`:
```javascript
import { Status } from '../domain/enums/Status.js';
import logger from '../infrastructure/logger.js';

export async function acknowledgeVuln(cveId, changedBy, cache) {
  const vuln = cache.get(cveId);
  if (!vuln) throw new Error(`CVE ${cveId} not found`);

  if (vuln.status === Status.RESOLVED) {
    throw new Error('Cannot acknowledge a resolved vulnerability');
  }

  vuln.updateStatus(Status.ACKNOWLEDGED, changedBy, new Date().toISOString());
  await cache.update(cveId, {
    status: Status.ACKNOWLEDGED,
    statusChangedBy: changedBy,
    statusChangedAt: new Date().toISOString()
  });

  logger.info({ cveId, changedBy, newStatus: Status.ACKNOWLEDGED }, 'Vulnerability acknowledged');
  return vuln;
}
```

`src/application/resolveVuln.js`:
```javascript
import { Status } from '../domain/enums/Status.js';

export async function resolveVuln(cveId, changedBy, cache) {
  const vuln = cache.get(cveId);
  if (!vuln) throw new Error(`CVE ${cveId} not found`);

  vuln.updateStatus(Status.RESOLVED, changedBy, new Date().toISOString());
  await cache.update(cveId, {
    status: Status.RESOLVED,
    statusChangedBy: changedBy,
    statusChangedAt: new Date().toISOString(),
    resolvedAt: new Date().toISOString()
  });

  logger.info({ cveId, changedBy, newStatus: Status.RESOLVED }, 'Vulnerability resolved');
  return vuln;
}
```

### Step 2: Create Middleware

`src/middleware/auth.js`:
```javascript
import logger from '../infrastructure/logger.js';

export function requireApiKey(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  const validKey = process.env.API_KEY;

  if (!apiKey || apiKey !== validKey) {
    logger.warn({ path: req.path, ip: req.ip }, 'Unauthorized API key');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  next();
}
```

### Step 3: Create REST Routes

`src/interface/http/apiRoutes.js`:
```javascript
import express from 'express';
import { requireApiKey } from '../../middleware/auth.js';
import { acknowledgeVuln } from '../../application/acknowledgeVuln.js';
import { resolveVuln } from '../../application/resolveVuln.js';

export function createApiRoutes(cache) {
  const router = express.Router();

  router.use(requireApiKey);

  // PATCH /api/v1/vulnerabilities/:cveId/status
  router.patch('/vulnerabilities/:cveId/status', async (req, res) => {
    const { cveId } = req.params;
    const { status, changedBy } = req.body;

    try {
      let vuln;
      if (status === 'ACKNOWLEDGED') {
        vuln = await acknowledgeVuln(cveId, changedBy, cache);
      } else if (status === 'RESOLVED') {
        vuln = await resolveVuln(cveId, changedBy, cache);
      } else {
        return res.status(400).json({ error: 'Invalid status' });
      }

      res.json(vuln);
    } catch (error) {
      res.status(404).json({ error: error.message });
    }
  });

  // GET /api/v1/vulnerabilities
  router.get('/vulnerabilities', (req, res) => {
    const { status, severity, tech } = req.query;
    const allVulns = cache.getAll();

    let filtered = allVulns;
    if (status) filtered = filtered.filter(v => v.status === status);
    if (severity) filtered = filtered.filter(v => v.severity === severity);
    if (tech) filtered = filtered.filter(v => v.affectedTechnologies.includes(tech));

    res.json(filtered);
  });

  // GET /api/v1/stats
  router.get('/stats', (req, res) => {
    const allVulns = cache.getAll();
    const stats = {
      byStatus: {},
      bySeverity: {},
      bySource: {},
      total: allVulns.length
    };

    allVulns.forEach(v => {
      stats.byStatus[v.status] = (stats.byStatus[v.status] || 0) + 1;
      stats.bySeverity[v.severity] = (stats.bySeverity[v.severity] || 0) + 1;
      stats.bySource[v.source] = (stats.bySource[v.source] || 0) + 1;
    });

    res.json(stats);
  });

  return router;
}
```

### Step 4: Update interface/http/index.js

Refactor to use the new routes:
```javascript
import express from 'express';
import { createApiRoutes } from './apiRoutes.js';

app.use('/api/v1', createApiRoutes(cache));
```

---

## Validation Conditions

### Condition 1: Use Case Functions Exist
```bash
test -f src/application/acknowledgeVuln.js && \
test -f src/application/resolveVuln.js && \
echo "✅ Use case files exist"
```

### Condition 2: Use Cases Export Functions
```javascript
import { acknowledgeVuln } from 'src/application/acknowledgeVuln.js';
import { resolveVuln } from 'src/application/resolveVuln.js';
console.assert(typeof acknowledgeVuln === 'function', 'acknowledgeVuln missing');
console.assert(typeof resolveVuln === 'function', 'resolveVuln missing');
console.log('✅ Use case functions exported');
```

### Condition 3: Middleware Exists
```bash
test -f src/middleware/auth.js
echo "✅ Auth middleware exists"
```

### Condition 4: API Routes Exist
```bash
test -f src/interface/http/apiRoutes.js
grep -q "requireApiKey\|PATCH.*status\|GET.*vulnerabilities" src/interface/http/apiRoutes.js
echo "✅ API routes implemented"
```

### Condition 5: API Key Validation Works
```bash
# Start app, test unauthorized request
curl -X GET http://localhost:3000/api/v1/vulnerabilities \
  -H "Content-Type: application/json" | grep -q "Unauthorized"
echo "✅ API key validation enforced"
```

### Condition 6: Status Update Endpoint Works
```bash
# Test with API key
curl -X PATCH http://localhost:3000/api/v1/vulnerabilities/CVE-2024-0001/status \
  -H "X-API-Key: ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"status":"ACKNOWLEDGED","changedBy":"test"}'
echo "✅ Status update endpoint works"
```

### Condition 7: Query Filters Work
```bash
# Test filtering
curl http://localhost:3000/api/v1/vulnerabilities?status=OPEN \
  -H "X-API-Key: ${API_KEY}" | grep -q "OPEN"
echo "✅ Query filters work"
```

### Condition 8: Stats Endpoint Works
```bash
curl http://localhost:3000/api/v1/stats \
  -H "X-API-Key: ${API_KEY}" | grep -q "byStatus\|bySource"
echo "✅ Stats endpoint works"
```

---

## Proof Required

Before marking VERIFIED, provide:

1. **File existence** (Condition 1)
2. **Function export test output** (Condition 2)
3. **Auth middleware existence** (Condition 3)
4. **Grep output** showing API routes (Condition 4)
5. **curl output** showing unauthorized rejection (Condition 5)
6. **curl output** showing successful status update (Condition 6)
7. **curl output** showing filtered results (Condition 7)
8. **curl output** showing stats (Condition 8)
9. **Database verification** showing status changes persisted
10. **Git diff** showing all changes

---

## Proof of Verification

_To be filled in after implementation_

```
Condition 1: [✅/❌] Use case files exist
Condition 2: [✅/❌] Functions exported
Condition 3: [✅/❌] Auth middleware exists
Condition 4: [✅/❌] API routes implemented
Condition 5: [✅/❌] API key validation
Condition 6: [✅/❌] Status update endpoint
Condition 7: [✅/❌] Query filters
Condition 8: [✅/❌] Stats endpoint

Overall Status: TODO → IN_PROGRESS → VERIFIED ✅
Verified At: [timestamp]
Verified By: [name]
```

---

## Notes

- API key from `X-API-Key` header, not URL params
- Status transitions: OPEN can go to ACKNOWLEDGED or RESOLVED, ACKNOWLEDGED can only go to RESOLVED
- Only require API key for mutation endpoints (POST/PATCH/DELETE), not GET
- Logging should include who changed status and from what to what
