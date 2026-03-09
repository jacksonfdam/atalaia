# Ticket #8: Technology Configuration

**Status:** TODO
**Verified:** ❌
**Depends On:** #6 (Status Lifecycle)
**Blocks:** #13
**Priority:** MEDIUM

---

## Task Description

Move technology filters from inline config to `config/technologies.json` and create API endpoints to view/update them.

### What Needs to Be Built

1. **`config/technologies.json`** — Technology filter config file
2. **`GET /api/v1/technologies`** — Read current filters
3. **`POST /api/v1/technologies`** — Update tech filters
4. **Validation** — Only valid technologies can be added

---

## Why This Matters

- **Single Source of Truth:** Config separate from code
- **Runtime Updates:** Future scanner can update filters via API
- **Auditability:** Logging tracks filter changes
- **Flexibility:** No need to restart app to change techs

---

## Acceptance Criteria

- [ ] `config/technologies.json` created with filter array
- [ ] Config has structure: `{ filters: [...], matchMode: "any" }`
- [ ] Default filters include React, Node.js, PostgreSQL, Docker, etc.
- [ ] `GET /api/v1/technologies` returns current filters
- [ ] `POST /api/v1/technologies` accepts `{ technologies: [...] }`
- [ ] POST validates and persists to `config/technologies.json`
- [ ] Filtering still works (case-insensitive match)
- [ ] Logging tracks config changes

---

## Implementation Steps

### Step 1: Create Config File

Create `config/technologies.json`:
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

### Step 2: Add API Endpoints

Update `src/interface/http/apiRoutes.js`:
```javascript
import fs from 'fs/promises';
import path from 'path';

export function createApiRoutes(cache, configPath) {
  const router = express.Router();

  // GET /api/v1/technologies
  router.get('/technologies', async (req, res) => {
    try {
      const config = JSON.parse(
        await fs.readFile(configPath, 'utf-8')
      );
      res.json(config);
    } catch (error) {
      res.status(500).json({ error: 'Failed to read config' });
    }
  });

  // POST /api/v1/technologies (protected)
  router.post('/technologies', requireApiKey, async (req, res) => {
    const { technologies } = req.body;

    if (!Array.isArray(technologies)) {
      return res.status(400).json({ error: 'technologies must be an array' });
    }

    try {
      const config = {
        filters: technologies,
        matchMode: 'any'
      };

      await fs.writeFile(configPath, JSON.stringify(config, null, 2));
      logger.info({ count: technologies.length }, 'Technology filters updated');
      res.json(config);
    } catch (error) {
      res.status(500).json({ error: 'Failed to update config' });
    }
  });

  return router;
}
```

### Step 3: Update Config Loading

Update `src/infrastructure/config.js` to load from `config/technologies.json`:
```javascript
import { readFileSync } from 'fs';
import path from 'path';

export function loadTechConfig() {
  const configPath = path.join(process.cwd(), 'config', 'technologies.json');
  const data = readFileSync(configPath, 'utf-8');
  return JSON.parse(data);
}
```

---

## Validation Conditions

### Condition 1: Config File Exists
```bash
test -f config/technologies.json
echo "✅ Config file exists"
```

### Condition 2: Config File Valid JSON
```bash
cat config/technologies.json | jq . > /dev/null
echo "✅ Config JSON valid"
```

### Condition 3: GET Endpoint Works
```bash
curl http://localhost:3000/api/v1/technologies | jq . | grep -q "filters\|matchMode"
echo "✅ GET /api/v1/technologies works"
```

### Condition 4: POST Endpoint Works
```bash
curl -X POST http://localhost:3000/api/v1/technologies \
  -H "X-API-Key: ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"technologies":["react","node.js"]}' | jq . | grep -q "react"
echo "✅ POST /api/v1/technologies works"
```

### Condition 5: Config Persists After POST
```bash
# Verify file was updated
grep -q "react" config/technologies.json
echo "✅ Config persisted to file"
```

### Condition 6: POST Requires API Key
```bash
# Test without API key
curl -X POST http://localhost:3000/api/v1/technologies \
  -H "Content-Type: application/json" | grep -q "Unauthorized"
echo "✅ POST requires API key"
```

---

## Proof Required

Before marking VERIFIED, provide:

1. **File existence and content** (Condition 1-2)
2. **GET endpoint curl output** (Condition 3)
3. **POST endpoint curl output** (Condition 4)
4. **File verification** showing persistence (Condition 5)
5. **Unauthorized curl output** (Condition 6)
6. **Logging output** showing config change
7. **Git diff** showing new files

---

## Proof of Verification

_To be filled in after implementation_

```
Condition 1: [✅/❌] Config file exists
Condition 2: [✅/❌] Valid JSON
Condition 3: [✅/❌] GET endpoint works
Condition 4: [✅/❌] POST endpoint works
Condition 5: [✅/❌] Config persists
Condition 6: [✅/❌] POST protected

Overall Status: TODO → IN_PROGRESS → VERIFIED ✅
Verified At: [timestamp]
Verified By: [name]
```

---

## Notes

- Config file path: `config/technologies.json` (not `src/`)
- GET endpoint requires no auth (public info)
- POST requires API key auth
- Validation: only POST, no DELETE
