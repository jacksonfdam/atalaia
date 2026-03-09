# Ticket #9: API Security

**Status:** TODO
**Verified:** ❌
**Depends On:** #6 (Status Lifecycle), #8 (Tech Config)
**Blocks:** #10+
**Priority:** HIGH

---

## Task Description

Harden API security with proper authentication, rate limiting, HTTPS headers, and request validation.

### What Needs to Be Built

1. **API Key Validation** — Already exists in middleware/auth.js, needs verification
2. **Request Body Validation** — Ensure valid input types
3. **CORS Configuration** — Allow safe origins only
4. **Security Headers** — X-Content-Type-Options, X-Frame-Options, etc.
5. **Rate Limiting** (optional for Phase 1)

---

## Why This Matters

- **Injection Prevention:** No malformed requests bypass validation
- **Unauthorized Access:** API key required for mutations
- **CSRF Protection:** Proper headers prevent attacks
- **Data Protection:** Sensitive endpoints restricted

---

## Acceptance Criteria

- [ ] `middleware/auth.js` validates API key on all mutation endpoints
- [ ] `/health` endpoint accessible without API key
- [ ] `/api/v1/technologies` GET accessible without API key
- [ ] Request bodies validated for type and content
- [ ] Invalid API keys return 401 with no detail
- [ ] Security headers set in all responses
- [ ] CORS allows specific origins (configurable)
- [ ] Input sanitization prevents injection

---

## Implementation Steps

### Step 1: Verify API Key Middleware

`src/middleware/auth.js` (already created in #6):
```javascript
import logger from '../infrastructure/logger.js';

export function requireApiKey(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  const validKey = process.env.API_KEY;

  if (!apiKey || apiKey !== validKey) {
    logger.warn({ path: req.path, ip: req.ip }, 'Unauthorized API access');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  next();
}
```

### Step 2: Add Security Headers

Update `src/interface/http/index.js`:
```javascript
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});
```

### Step 3: Add CORS

Update `src/interface/http/index.js`:
```javascript
import cors from 'cors';

const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3000').split(',');
app.use(cors({
  origin: allowedOrigins,
  credentials: true
}));
```

### Step 4: Validate Request Bodies

Update route handlers:
```javascript
router.post('/technologies', requireApiKey, (req, res) => {
  const { technologies } = req.body;

  if (!Array.isArray(technologies)) {
    return res.status(400).json({ error: 'technologies must be an array' });
  }

  if (!technologies.every(t => typeof t === 'string')) {
    return res.status(400).json({ error: 'All technologies must be strings' });
  }

  // ... proceed
});
```

---

## Validation Conditions

### Condition 1: API Key Required for Mutations
```bash
# Test POST without key
curl -X POST http://localhost:3000/api/v1/technologies \
  -H "Content-Type: application/json" \
  -d '{"technologies":["test"]}' | grep -q "Unauthorized"
echo "✅ POST requires API key"
```

### Condition 2: /health Accessible Without Key
```bash
curl http://localhost:3000/health | grep -q "ok\|healthy"
echo "✅ /health accessible without auth"
```

### Condition 3: Invalid Input Rejected
```bash
curl -X POST http://localhost:3000/api/v1/technologies \
  -H "X-API-Key: ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"technologies":"not-an-array"}' | grep -q "array"
echo "✅ Invalid input rejected"
```

### Condition 4: Security Headers Present
```bash
curl -I http://localhost:3000/health | grep -q "X-Content-Type-Options"
curl -I http://localhost:3000/health | grep -q "X-Frame-Options"
echo "✅ Security headers present"
```

### Condition 5: CORS Configured
```bash
curl -H "Origin: http://localhost:3000" http://localhost:3000/health | grep -q "Access-Control-Allow"
echo "✅ CORS headers present"
```

---

## Proof Required

Before marking VERIFIED, provide:

1. **curl output** showing 401 without API key (Condition 1)
2. **curl output** showing /health works without auth (Condition 2)
3. **curl output** showing invalid input rejected (Condition 3)
4. **curl -I output** showing security headers (Condition 4)
5. **curl output** showing CORS headers (Condition 5)
6. **Git diff** showing middleware and config changes

---

## Proof of Verification

_To be filled in after implementation_

```
Condition 1: [✅/❌] API key required for mutations
Condition 2: [✅/❌] /health public
Condition 3: [✅/❌] Invalid input rejected
Condition 4: [✅/❌] Security headers
Condition 5: [✅/❌] CORS configured

Overall Status: TODO → IN_PROGRESS → VERIFIED ✅
Verified At: [timestamp]
Verified By: [name]
```

---

## Notes

- API key from header only (not URL params or body)
- No detailed error messages (don't reveal why auth failed)
- CORS_ORIGINS: comma-separated, from env
- Rate limiting deferred to Phase 2
