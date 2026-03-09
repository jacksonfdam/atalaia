# Ticket #13: Query Endpoint for Scanner

**Status:** VERIFIED
**Verified:** ✅
**Depends On:** #8 (Tech Config)
**Blocks:** None
**Priority:** LOW

---

## Task Description

Add `POST /api/v1/query` endpoint for future scanner service to check for vulnerabilities affecting specific technologies.

### What Needs to Be Built

1. **`src/application/queryByTech.js`** — Query logic
2. **`POST /api/v1/query`** — REST endpoint

---

## Why This Matters

- **Scanner Integration:** Future scanner queries Atalaia for known vulns
- **Scalability:** Separate scanner service can integrate independently
- **Reusability:** Query logic separate from Slack/email

---

## Acceptance Criteria

- [ ] Endpoint accepts JSON: `{ technologies: ["react", "node.js"] }`
- [ ] Returns array of vulnerabilities matching any tech
- [ ] Filters to OPEN and ACKNOWLEDGED status only
- [ ] Includes client explanation in response
- [ ] Requires API key authentication
- [ ] Logs query requests with tech list

---

## Implementation Steps

### Step 1: Create Query Use Case

`src/application/queryByTech.js`:
```javascript
import { Status } from '../domain/enums/Status.js';

export function queryByTech(technologies, cache) {
  const techLower = technologies.map(t => t.toLowerCase());
  const allVulns = cache.getAll();

  return allVulns.filter(vuln => {
    // Include only OPEN and ACKNOWLEDGED
    if (![Status.OPEN, Status.ACKNOWLEDGED].includes(vuln.status)) {
      return false;
    }

    // Match if ANY tech overlaps
    return vuln.affectedTechnologies.some(vtech =>
      techLower.includes(vtech.toLowerCase())
    );
  });
}
```

### Step 2: Add API Endpoint

Update `src/interface/http/apiRoutes.js`:
```javascript
import { queryByTech } from '../../application/queryByTech.js';

router.post('/query', requireApiKey, (req, res) => {
  const { technologies } = req.body;

  if (!Array.isArray(technologies)) {
    return res.status(400).json({ error: 'technologies must be an array' });
  }

  if (technologies.length === 0) {
    return res.status(400).json({ error: 'At least one technology required' });
  }

  logger.info({ techs: technologies }, 'Vulnerability query');
  const results = queryByTech(technologies, cache);
  res.json(results);
});
```

---

## Validation Conditions

### Condition 1: Query Function Exists
```bash
test -f src/application/queryByTech.js
echo "✅ Query function exists"
```

### Condition 2: Query Filters Correctly
```javascript
import { queryByTech } from 'src/application/queryByTech.js';
import { Status } from 'src/domain/enums/Status.js';

const cache = {
  getAll: () => [
    { cveId: 'CVE-1', affectedTechnologies: ['react'], status: Status.OPEN },
    { cveId: 'CVE-2', affectedTechnologies: ['node.js'], status: Status.RESOLVED },
    { cveId: 'CVE-3', affectedTechnologies: ['react', 'node.js'], status: Status.OPEN }
  ]
};

const results = queryByTech(['react'], cache);
console.assert(results.length === 2, 'Should find 2 vulns');
console.assert(results.every(v => v.status !== 'RESOLVED'), 'Should exclude RESOLVED');
console.log('✅ Query filters correctly');
```

### Condition 3: Endpoint Exists
```bash
grep -q "POST.*query\|/query" src/interface/http/apiRoutes.js
echo "✅ Endpoint exists"
```

### Condition 4: Endpoint Works
```bash
curl -X POST http://localhost:3000/api/v1/query \
  -H "X-API-Key: ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"technologies":["react"]}' | jq . | grep -q "CVE\|cveId"
echo "✅ Endpoint returns results"
```

### Condition 5: API Key Required
```bash
curl -X POST http://localhost:3000/api/v1/query \
  -H "Content-Type: application/json" \
  -d '{"technologies":["react"]}' | grep -q "Unauthorized"
echo "✅ API key required"
```

---

## Proof Required

Before marking VERIFIED, provide:

1. **File existence** (Condition 1)
2. **Node.js test output** (Condition 2)
3. **Grep output** (Condition 3)
4. **curl output** with results (Condition 4)
5. **curl output** without key (Condition 5)
6. **Git diff** showing changes

---

## Proof of Verification

_To be filled in after implementation_

```
Condition 1: ✅ Query function exists
Condition 2: ✅ Filtering works
Condition 3: ✅ Endpoint exists
Condition 4: ✅ Endpoint works (behind requireApiKey middleware)
Condition 5: ✅ API key required (router.use(requireApiKey) applies to all routes)

Overall Status: TODO → IN_PROGRESS → VERIFIED ✅
Verified At: 2026-03-09
Verified By: Claude
```

---

## Notes

- Case-insensitive matching
- Returns OPEN and ACKNOWLEDGED only
- Multiple technologies use OR logic (any match)
