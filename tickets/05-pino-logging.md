# Ticket #5: Pino Logging Implementation

**Status:** TODO
**Verified:** ❌
**Depends On:** #3 (Split Feeds), #4 (Source Priority)
**Blocks:** #6+
**Priority:** MEDIUM

---

## Task Description

Replace all `console.log`, `console.error`, `console.warn` statements with structured logging via Pino. Set up logger configuration and ensure consistent contextual logging across the codebase.

### What Needs to Be Built

1. **`src/infrastructure/logger.js`** — Pino logger factory
2. **Update all files** — Replace `console.*` with `logger.*`
3. **Configure logging levels** — Via `LOG_LEVEL` env var (default: 'info')

---

## Why This Matters

- **Observability:** Structured logs with context (feed names, CVE IDs, error details)
- **Production Ready:** JSON logging for log aggregation systems
- **Debugging:** Consistent format makes troubleshooting easier
- **Auditability:** Track feed performance, failure rates, retry attempts

---

## Acceptance Criteria

- [ ] `src/infrastructure/logger.js` created with Pino factory
- [ ] All `console.log` statements replaced with `logger.info()` or `logger.debug()`
- [ ] All `console.error` replaced with `logger.error()`
- [ ] All `console.warn` replaced with `logger.warn()`
- [ ] Logger respects `LOG_LEVEL` env var
- [ ] All log calls include context object (first parameter)
- [ ] No bare `console.*` statements remain in codebase
- [ ] Logger is imported consistently across all modules

---

## Implementation Steps

### Step 1: Create Logger Module

Create `src/infrastructure/logger.js`:

```javascript
import pino from 'pino';

const logLevel = process.env.LOG_LEVEL || 'info';

const logger = pino({
  level: logLevel,
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: process.env.NODE_ENV !== 'production',
      singleLine: false,
      translateTime: 'SYS:standard'
    }
  }
});

export default logger;
```

### Step 2: Update All Modules

In each file, add at the top:
```javascript
import logger from './infrastructure/logger.js'; // adjust path as needed
```

Then replace all logging:
- `console.log(msg)` → `logger.info({ context: 'value' }, 'msg')`
- `console.error(err)` → `logger.error({ error: err.message, stack: err.stack }, 'msg')`
- `console.warn(msg)` → `logger.warn({ context }, 'msg')`

Examples:
```javascript
// Before:
console.log('Fetching CISA feed');

// After:
logger.info({ feed: 'cisa' }, 'Fetching CISA feed');

// Before:
console.error(`Feed failed: ${error.message}`);

// After:
logger.error({ feed: 'snyk', error: error.message }, 'Feed fetch failed');

// Before:
console.log(`Processing 5 vulnerabilities`);

// After:
logger.info({ count: 5, feed: 'vuldb' }, 'Processing vulnerabilities');
```

### Step 3: Verify No console Statements

```bash
grep -r "console\." src/ && echo "❌ Found console statements!" && exit 1
echo "✅ All console statements replaced"
```

---

## Validation Conditions

### Condition 1: Logger Module Exists
```bash
test -f src/infrastructure/logger.js
echo "✅ Logger module exists"
```

### Condition 2: Logger Exports Default
```javascript
import logger from 'src/infrastructure/logger.js';
console.assert(logger && typeof logger.info === 'function', 'Logger missing methods');
console.log('✅ Logger exports correctly');
```

### Condition 3: Logger Respects LOG_LEVEL
```bash
# Set LOG_LEVEL=debug and verify debug logs appear
LOG_LEVEL=debug node --input-type=module << 'EOF'
import logger from './src/infrastructure/logger.js';
logger.debug({ test: true }, 'Debug message');
logger.info({ test: true }, 'Info message');
// Should see both messages
EOF
```

### Condition 4: No console.* Statements in Codebase
```bash
grep -r "console\." src/ && echo "❌ Found console statements!" && exit 1
echo "✅ All console statements removed"
```

### Condition 5: Logger Imported in All Modules
```bash
# Count files and logger imports
total_js_files=$(find src -name "*.js" -type f | wc -l)
logger_imports=$(grep -r "import.*logger\|require.*logger" src | wc -l)
# At least one import per file (roughly)
echo "✅ Logger imported in modules (check manually)"
```

### Condition 6: Log Calls Have Context Objects
```bash
# Sample check: find logger calls with context
grep -r "logger\.\(info\|error\|warn\)" src | grep "{" | head -3
echo "✅ Logger calls include context objects"
```

### Condition 7: Application Runs Without console Warnings
```bash
npm run dev &
PID=$!
sleep 5
kill $PID
# Check logs for proper formatting
echo "✅ App runs with structured logging"
```

---

## Proof Required

Before marking VERIFIED, provide:

1. **File existence** (Condition 1)
2. **Logger import test output** (Condition 2)
3. **LOG_LEVEL test output** (Condition 3)
4. **Grep output** confirming no console.* (Condition 4)
5. **Grep output** showing logger imports (Condition 5)
6. **Sample log output** showing context objects (Condition 6)
7. **App startup output** showing structured logs (Condition 7)
8. **Full git diff** showing all replacements

---

## Proof of Verification

_To be filled in after implementation_

```
Condition 1: [✅/❌] Logger module exists
Condition 2: [✅/❌] Logger exports correctly
Condition 3: [✅/❌] LOG_LEVEL env var works
Condition 4: [✅/❌] No console.* statements
Condition 5: [✅/❌] Logger imported in modules
Condition 6: [✅/❌] Context objects present
Condition 7: [✅/❌] Structured logging in action

Overall Status: TODO → IN_PROGRESS → VERIFIED ✅
Verified At: [timestamp]
Verified By: [name]
```

---

## Notes

- In dev: use pino-pretty for human-readable output
- In prod: use JSON format (remove pretty transport)
- Never log sensitive data (API keys, tokens)
- Use structured context, not string concatenation
- All feed fetches should log: feed name, attempt count, duration, success/failure

## Files to Update

Expected to touch all these files:
- `src/application/monitorVulns.js`
- `src/infrastructure/feeds/*.js` (all 5 files)
- `src/infrastructure/cache/sqliteCache.js`
- `src/infrastructure/config.js`
- `src/infrastructure/notifySlack.js`
- `src/infrastructure/scheduler.js`
- `src/interface/index.js`
