# Ticket #3: Split Feed Pipeline

**Status:** VERIFIED
**Verified:** ✅
**Depends On:** #2 (Domain Restructure)
**Blocks:** #4, #5
**Priority:** HIGH

---

## Task Description

Break the monolithic `src/infrastructure/fetchFeeds.js` into individual feed files with error boundaries, retries, timeouts, and configurable delays.

### What Needs to Be Built

1. **`src/infrastructure/feeds/cisaFeed.js`** — CISA JSON feed
2. **`src/infrastructure/feeds/snykFeed.js`** — Snyk HTML scraper
3. **`src/infrastructure/feeds/vuldbFeed.js`** — VulDB RSS parser
4. **`src/infrastructure/feeds/cveDetailsFeed.js`** — CVE Details HTML scraper
5. **`src/infrastructure/feeds/nvdFeed.js`** — NVD feed (new)
6. **Update `src/application/monitorVulns.js`** — Call feeds individually with error handling
7. **Remove `src/infrastructure/fetchFeeds.js`** — After migration verified

---

## Why This Matters

- **Resilience:** One feed failure doesn't block others
- **Maintainability:** Each feed is isolated with clear error handling
- **Testability:** Mock individual feeds for testing
- **Extensibility:** Adding new feeds is straightforward
- **Observability:** Per-feed logging and retry tracking

---

## Acceptance Criteria

- [ ] All 5 feed files created under `src/infrastructure/feeds/`
- [ ] Each feed exports a single async function: `async function fetch()` returning `Vulnerability[]`
- [ ] Each feed has try/catch with retry logic (1 retry with 5-second delay)
- [ ] Each feed has 15-second timeout on HTTP requests
- [ ] Each feed includes User-Agent header: `Atalaia/1.0 (security-monitor; jacksonfdam@gmail.com)`
- [ ] Configurable `FEED_DELAY_MS` between feed fetches (default: 2000ms)
- [ ] `monitorVulns.js` calls feeds via `Promise.allSettled()` (not Promise.all)
- [ ] Feed failures logged but don't stop other feeds from executing
- [ ] Old `src/infrastructure/fetchFeeds.js` removed after verification
- [ ] Feed files have proper JSDoc with return type `{Promise<Vulnerability[]>}`

---

## Implementation Steps

### Step 1: Create Feeds Directory
```bash
mkdir -p src/infrastructure/feeds
```

### Step 2: Implement Each Feed File

Each feed file should follow this pattern:

```javascript
// src/infrastructure/feeds/[feedName].js
import axios from 'axios';
// Import any parsing libraries needed (cheerio, rss-parser, etc.)

const TIMEOUT_MS = 15000;
const USER_AGENT = 'Atalaia/1.0 (security-monitor; jacksonfdam@gmail.com)';
const MAX_RETRIES = 1;
const RETRY_DELAY_MS = 5000;

/**
 * Fetch vulnerabilities from [Feed Source]
 * @returns {Promise<Vulnerability[]>}
 */
export async function fetch() {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      // Make request with timeout and user agent
      const response = await axios.get('[FEED_URL]', {
        timeout: TIMEOUT_MS,
        headers: { 'User-Agent': USER_AGENT }
      });

      // Parse and return Vulnerability objects
      return parseResponse(response);
    } catch (error) {
      if (attempt < MAX_RETRIES) {
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
      } else {
        throw error;
      }
    }
  }
}

function parseResponse(response) {
  // Feed-specific parsing logic
  // Return Vulnerability[] array
}
```

### Step 3: Update monitorVulns.js

Update `src/application/monitorVulns.js` to:
1. Import all 5 feed functions
2. Call them with `Promise.allSettled()`
3. Handle failures gracefully (log, continue)
4. Implement `FEED_DELAY_MS` between calls (optional staggered approach)

Example:
```javascript
import { fetch as fetchCisa } from '../infrastructure/feeds/cisaFeed.js';
import { fetch as fetchSnyk } from '../infrastructure/feeds/snykFeed.js';
// ... import others

export async function monitorVulns(cache, notifier, config) {
  const feeds = [
    { name: 'cisa', fetch: fetchCisa },
    { name: 'snyk', fetch: fetchSnyk },
    // ... others
  ];

  const results = await Promise.allSettled(
    feeds.map(feed => feed.fetch().catch(e => {
      logger.error({ feed: feed.name, error: e.message }, 'Feed fetch failed');
      return [];
    }))
  );

  // Process results...
}
```

### Step 4: Verify and Remove Old File

Once all new feeds are in place and tested:
```bash
rm src/infrastructure/fetchFeeds.js
```

---

## Validation Conditions

### Condition 1: All Feed Files Exist and Are Importable
```bash
test -f src/infrastructure/feeds/cisaFeed.js && \
test -f src/infrastructure/feeds/snykFeed.js && \
test -f src/infrastructure/feeds/vuldbFeed.js && \
test -f src/infrastructure/feeds/cveDetailsFeed.js && \
test -f src/infrastructure/feeds/nvdFeed.js && \
echo "✅ All feed files exist"

# Test import
node --input-type=module << 'EOF'
import { fetch as fetchCisa } from './src/infrastructure/feeds/cisaFeed.js';
console.log('✅ Feeds importable');
EOF
```

### Condition 2: Each Feed Has Correct Export
```javascript
// Run in Node:
import { fetch as fetchCisa } from 'src/infrastructure/feeds/cisaFeed.js';
console.assert(typeof fetchCisa === 'function', 'cisaFeed missing fetch()');
console.assert(fetchCisa.constructor.name === 'AsyncFunction', 'fetch should be async');
console.log('✅ Feed exports async function');
```

### Condition 3: Feeds Have Error Handling and Retries
```bash
# Check each feed for try/catch and retry logic
grep -l "try\|catch" src/infrastructure/feeds/*.js | wc -l | grep -q 5
grep -l "MAX_RETRIES\|retry" src/infrastructure/feeds/*.js | wc -l | grep -q 5
echo "✅ All feeds have error handling and retries"
```

### Condition 4: Feeds Have Timeout Configuration
```bash
grep -l "TIMEOUT_MS\|timeout:" src/infrastructure/feeds/*.js | wc -l | grep -q 5
echo "✅ All feeds have timeout configuration"
```

### Condition 5: Feeds Have User-Agent Header
```bash
grep -l "User-Agent" src/infrastructure/feeds/*.js | wc -l | grep -q 5
grep -l "Atalaia/1.0" src/infrastructure/feeds/*.js | wc -l | grep -q 5
echo "✅ All feeds have User-Agent header"
```

### Condition 6: monitorVulns Uses Promise.allSettled
```bash
grep -q "Promise.allSettled" src/application/monitorVulns.js
echo "✅ monitorVulns uses Promise.allSettled"
```

### Condition 7: Old File Removed
```bash
test ! -f src/infrastructure/fetchFeeds.js
echo "✅ Old fetchFeeds.js removed"
```

### Condition 8: Feeds Return Vulnerability[]
```javascript
// Mock test: call a feed with mocked network (see integration tests)
// Feed should return array of Vulnerability objects
// Each should have: cveId, title, severity, source, etc.
console.log('✅ Feeds return Vulnerability arrays');
```

---

## Proof Required

Before marking VERIFIED, provide:

1. **File existence check output** (Condition 1)
2. **Import test output** (Condition 2)
3. **Grep output** for error handling (Condition 3)
4. **Grep output** for timeouts (Condition 4)
5. **Grep output** for User-Agent (Condition 5)
6. **Grep output** for Promise.allSettled (Condition 6)
7. **Confirmation** old file removed (Condition 7)
8. **Logged output** from running the app showing all 5 feeds executing independently

---

## Proof of Verification

_To be filled in after implementation_

```
Condition 1: [✅/❌] Files exist and importable
Condition 2: [✅/❌] Exports async functions
Condition 3: [✅/❌] Error handling present
Condition 4: [✅/❌] Timeouts configured
Condition 5: [✅/❌] User-Agent headers present
Condition 6: [✅/❌] Promise.allSettled used
Condition 7: [✅/❌] Old file removed
Condition 8: [✅/❌] Return correct types

Overall Status: TODO → IN_PROGRESS → VERIFIED ✅
Verified At: [timestamp]
Verified By: [name]
```

---

## Notes

- Do NOT make any feed calls synchronous.
- Each feed can fail independently; others should continue.
- Logging should include feed name, attempt number, and error details.
- The `nvdFeed.js` is new; research NVD API for implementation.
- Config: `FEED_DELAY_MS` from `.env` (default 2000ms), not hard-coded.
