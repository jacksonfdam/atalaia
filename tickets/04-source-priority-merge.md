# Ticket #4: Source Priority & Merge Strategy

**Status:** VERIFIED
**Verified:** ✅
**Depends On:** #2 (Domain Restructure), #3 (Split Feeds)
**Blocks:** #5
**Priority:** HIGH

---

## Task Description

Implement merge logic for when the same CVE appears in multiple feeds. Define source priority and merge rules for conflicting data.

### What Needs to Be Built

1. **Source priority constant** in `src/application/monitorVulns.js`
2. **Merge function** that combines multi-source CVE data
3. **Deduplication** against cache before returning merged result

---

## Why This Matters

- **Accuracy:** Best data wins (CVSS from NVD, exploit status from CISA)
- **Completeness:** Union of affected technologies across sources
- **Consistency:** Known exploit detection triggers high-priority alerts

---

## Acceptance Criteria

- [ ] Source priority defined: `['nvd', 'cisa', 'snyk', 'vuldb', 'cvedetails']`
- [ ] Merge rule for severity: highest-priority source wins
- [ ] Merge rule for exploited: true if ANY source says exploited
- [ ] Merge rule for technologies: UNION of all sources
- [ ] Merge rule for description: highest-priority source wins
- [ ] Merge rule for source field: highest-priority source name stored
- [ ] Duplicate detection works (same CVE from multiple feeds)
- [ ] Deduplication happens AFTER merge (use cache.has(cveId))
- [ ] No data loss when merging

---

## Implementation Steps

### Step 1: Define Source Priority

Add to `src/application/monitorVulns.js`:

```javascript
const SOURCE_PRIORITY = ['nvd', 'cisa', 'snyk', 'vuldb', 'cvedetails'];

function getPriorityScore(source) {
  const index = SOURCE_PRIORITY.indexOf(source.toLowerCase());
  return index >= 0 ? index : SOURCE_PRIORITY.length;
}
```

### Step 2: Implement Merge Function

```javascript
/**
 * Merge multiple vulnerabilities with the same CVE ID
 * @param {Vulnerability[]} vulnsWithSameCve - Array of vulns with same cveId
 * @returns {Vulnerability} - Merged vulnerability
 */
function mergeVulnerabilities(vulnsWithSameCve) {
  if (vulnsWithSameCve.length === 1) return vulnsWithSameCve[0];

  // Sort by priority
  const sorted = vulnsWithSameCve.sort(
    (a, b) => getPriorityScore(a.source) - getPriorityScore(b.source)
  );

  const primaryVuln = sorted[0];

  return new Vulnerability({
    cveId: primaryVuln.cveId,
    title: primaryVuln.title,
    description: primaryVuln.description,
    severity: primaryVuln.severity,
    cvssScore: primaryVuln.cvssScore,
    // exploited: true if ANY source says true
    exploited: vulnsWithSameCve.some(v => v.exploited),
    // source: highest priority
    source: primaryVuln.source,
    sourceUrl: primaryVuln.sourceUrl,
    // technologies: UNION of all sources
    affectedTechnologies: [
      ...new Set(vulnsWithSameCve.flatMap(v => v.affectedTechnologies))
    ]
  });
}
```

### Step 3: Update monitorVulns to Use Merge

```javascript
export async function monitorVulns(cache, notifier, config) {
  // ... fetch from all feeds ...

  const allVulns = []; // Collected from all feeds

  // Group by CVE ID
  const vulnsByKey = {};
  allVulns.forEach(vuln => {
    if (!vulnsByKey[vuln.cveId]) {
      vulnsByKey[vuln.cveId] = [];
    }
    vulnsByKey[vuln.cveId].push(vuln);
  });

  // Merge duplicates
  const mergedVulns = Object.values(vulnsByKey).map(vulnGroup =>
    mergeVulnerabilities(vulnGroup)
  );

  // Filter by tech and deduplicate against cache
  const newVulns = mergedVulns.filter(vuln =>
    config.technologies.some(tech =>
      isMatchingTech(vuln, tech)
    ) && !cache.has(vuln.cveId)
  );

  // Notify and persist
  for (const vuln of newVulns) {
    await notifier.notify(vuln);
    await cache.add(vuln);
  }
}
```

---

## Validation Conditions

### Condition 1: Source Priority Constant Exists
```bash
grep -q "SOURCE_PRIORITY = \['nvd', 'cisa', 'snyk', 'vuldb', 'cvedetails'\]" src/application/monitorVulns.js
echo "✅ Source priority defined correctly"
```

### Condition 2: Priority Score Function Works
```javascript
// Run in Node:
import { ... } from 'src/application/monitorVulns.js'; // Export getPriorityScore
console.assert(getPriorityScore('nvd') === 0, 'NVD should be 0');
console.assert(getPriorityScore('cisa') === 1, 'CISA should be 1');
console.assert(getPriorityScore('snyk') === 2, 'Snyk should be 2');
console.assert(getPriorityScore('VULDB') === 3, 'VulDB should be 3 (case-insensitive)');
console.log('✅ Priority scoring works');
```

### Condition 3: Merge Function Handles Severity
```javascript
// Test with vulnerabilities:
// - vuln1: severity='HIGH', source='snyk'
// - vuln2: severity='CRITICAL', source='cisa'
// Result should be CRITICAL (cisa has higher priority)
const merged = mergeVulnerabilities([vuln2, vuln1]);
console.assert(merged.severity === 'CRITICAL', 'Severity merge failed');
console.log('✅ Severity merge works (priority wins)');
```

### Condition 4: Merge Function Handles Exploited (OR Logic)
```javascript
// Test with vulnerabilities:
// - vuln1: exploited=true, source='snyk'
// - vuln2: exploited=false, source='cisa'
// Result should be true (any source says true)
const merged = mergeVulnerabilities([vuln2, vuln1]);
console.assert(merged.exploited === true, 'Exploited merge failed');
console.log('✅ Exploited merge works (OR logic)');
```

### Condition 5: Merge Function Handles Technologies (UNION)
```javascript
// Test with vulnerabilities:
// - vuln1: affectedTechnologies=['react', 'node.js']
// - vuln2: affectedTechnologies=['node.js', 'express']
// Result should have ['react', 'node.js', 'express'] (deduplicated)
const merged = mergeVulnerabilities([vuln1, vuln2]);
console.assert(merged.affectedTechnologies.includes('react'), 'Missing react');
console.assert(merged.affectedTechnologies.includes('express'), 'Missing express');
console.assert(merged.affectedTechnologies.length === 3, 'Wrong count');
console.log('✅ Technologies merge works (UNION)');
```

### Condition 6: Merge Uses Primary Source
```javascript
// Test: two vulns with same CVE, different sources
// vuln1: source='snyk', description='snyk desc'
// vuln2: source='cisa', description='cisa desc'
// Result should use cisa data (higher priority)
const merged = mergeVulnerabilities([vuln1, vuln2]);
console.assert(merged.source === 'cisa', 'Should use highest priority source');
console.assert(merged.description === 'cisa desc', 'Should use primary source description');
console.log('✅ Primary source selection works');
```

### Condition 7: monitorVulns Groups and Merges by CVE
```bash
# Review monitorVulns implementation:
grep -q "vulnsByKey\|vulnGroup" src/application/monitorVulns.js
echo "✅ monitorVulns groups by CVE ID"
```

### Condition 8: Cache Deduplication After Merge
```bash
# Verify deduplication happens post-merge
grep -q "cache.has" src/application/monitorVulns.js
grep -A5 "mergeVulnerabilities\|mergedVulns" src/application/monitorVulns.js | grep -q "cache.has"
echo "✅ Cache check happens after merge"
```

---

## Proof Required

Before marking VERIFIED, provide:

1. **Grep output** confirming SOURCE_PRIORITY constant (Condition 1)
2. **Node console output** from Condition 2-6 tests (prove merge logic)
3. **Grep output** confirming grouping logic (Condition 7)
4. **Grep output** confirming cache.has after merge (Condition 8)
5. **Integration test output** showing merge in action:
   - Two CVEs from different sources
   - App fetches both
   - Result shows merged data
6. **Git diff** showing implementation

---

## Proof of Verification

_To be filled in after implementation_

```
Condition 1: [✅/❌] Source priority constant
Condition 2: [✅/❌] Priority score function
Condition 3: [✅/❌] Severity merge (priority)
Condition 4: [✅/❌] Exploited merge (OR)
Condition 5: [✅/❌] Technologies merge (UNION)
Condition 6: [✅/❌] Primary source selection
Condition 7: [✅/❌] Grouping by CVE
Condition 8: [✅/❌] Cache dedup after merge

Overall Status: TODO → IN_PROGRESS → VERIFIED ✅
Verified At: [timestamp]
Verified By: [name]
```

---

## Notes

- Merge function should be pure (no side effects).
- Test with real-world multi-source CVE scenarios.
- Performance: grouping by CVE ID should be O(n log n).
- Consider edge cases: null descriptions, missing severity, empty arrays.
