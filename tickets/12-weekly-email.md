# Ticket #12: Weekly Email Reports

**Status:** TODO
**Verified:** ❌
**Depends On:** #6 (Status Lifecycle)
**Blocks:** None
**Priority:** LOW

---

## Task Description

Add weekly email reports grouped by severity containing all OPEN and ACKNOWLEDGED vulnerabilities.

### What Needs to Be Built

1. **`src/application/generateWeeklyReport.js`** — Generate report data
2. **`src/infrastructure/notifiers/emailNotifier.js`** — Send via SMTP
3. **Add cron job** — Scheduled weekly (configurable, default Monday 9 AM)

---

## Why This Matters

- **Executive Summary:** Weekly digest of security posture
- **Accountability:** Visibility into unresolved vulnerabilities
- **Trend Tracking:** Compare week-to-week metrics

---

## Acceptance Criteria

- [ ] Report generated for OPEN and ACKNOWLEDGED vulns only
- [ ] Grouped by severity: CRITICAL → HIGH → MEDIUM → LOW
- [ ] Includes CVE ID, severity, source, affected techs
- [ ] Sent via SMTP (configurable)
- [ ] Scheduled via cron (`WEEKLY_REPORT_CRON`, default: Monday 9 AM)
- [ ] Email includes recipient addresses from config
- [ ] Professional HTML or plain text format
- [ ] No email sent if no vulnerabilities

---

## Implementation Steps

### Step 1: Create Report Generator

`src/application/generateWeeklyReport.js`:
```javascript
import { Status } from '../domain/enums/Status.js';

export function generateWeeklyReport(vulnerabilities) {
  const severityOrder = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

  const filtered = vulnerabilities.filter(
    v => v.status === Status.OPEN || v.status === Status.ACKNOWLEDGED
  );

  if (filtered.length === 0) return null;

  const grouped = {};
  severityOrder.forEach(s => grouped[s] = []);

  filtered.forEach(v => {
    if (grouped[v.severity]) grouped[v.severity].push(v);
  });

  return {
    generatedAt: new Date().toISOString(),
    vulnerabilities: grouped
  };
}
```

### Step 2: Create Email Notifier

`src/infrastructure/notifiers/emailNotifier.js`:
```javascript
import nodemailer from 'nodemailer';
import logger from '../logger.js';

export async function sendWeeklyEmail(report, config) {
  if (!report) {
    logger.info('No vulnerabilities for weekly report');
    return;
  }

  const transporter = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_PORT === 465,
    auth: {
      user: config.SMTP_USER,
      pass: config.SMTP_PASS
    }
  });

  const html = formatReportHtml(report);
  const recipients = config.EMAIL_RECIPIENTS.split(',').map(e => e.trim());

  try {
    await transporter.sendMail({
      from: config.EMAIL_FROM,
      to: recipients.join(','),
      subject: `Weekly Vulnerability Report - ${new Date().toLocaleDateString()}`,
      html
    });

    logger.info({ count: countVulns(report), recipients }, 'Weekly email sent');
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to send weekly email');
  }
}

function formatReportHtml(report) {
  let html = '<h2>Weekly Vulnerability Report</h2>';

  Object.entries(report.vulnerabilities).forEach(([severity, vulns]) => {
    if (vulns.length === 0) return;

    html += `<h3>${severity} (${vulns.length})</h3><ul>`;
    vulns.forEach(v => {
      html += `<li><strong>${v.cveId}</strong>: ${v.title}<br/>Technologies: ${v.affectedTechnologies.join(', ')}</li>`;
    });
    html += '</ul>';
  });

  return html;
}

function countVulns(report) {
  return Object.values(report.vulnerabilities).reduce((sum, arr) => sum + arr.length, 0);
}
```

### Step 3: Add to Scheduler

Update `src/infrastructure/scheduler.js`:
```javascript
import { generateWeeklyReport } from '../application/generateWeeklyReport.js';
import { sendWeeklyEmail } from './notifiers/emailNotifier.js';

export function scheduleJobs(cache, config) {
  // Weekly report (default: Monday 9 AM)
  cron.schedule(config.WEEKLY_REPORT_CRON || '0 9 * * 1', async () => {
    logger.info('Running weekly report generation');
    const vulns = cache.getAll();
    const report = generateWeeklyReport(vulns);
    await sendWeeklyEmail(report, config);
  });
}
```

---

## Validation Conditions

### Condition 1: Report Generator Exists
```bash
test -f src/application/generateWeeklyReport.js
echo "✅ Report generator exists"
```

### Condition 2: Email Notifier Exists
```bash
test -f src/infrastructure/notifiers/emailNotifier.js
echo "✅ Email notifier exists"
```

### Condition 3: Report Filters Correctly
```javascript
import { generateWeeklyReport } from 'src/application/generateWeeklyReport.js';
import { Status } from 'src/domain/enums/Status.js';

const vulns = [
  { cveId: 'CVE-1', severity: 'CRITICAL', status: Status.OPEN },
  { cveId: 'CVE-2', severity: 'LOW', status: Status.RESOLVED },
];

const report = generateWeeklyReport(vulns);
console.assert(report.vulnerabilities.CRITICAL.length === 1, 'Filter failed');
console.assert(report.vulnerabilities.CRITICAL[0].cveId === 'CVE-1', 'Correct CVE');
console.log('✅ Report filtering works');
```

### Condition 4: Returns Null for No Vulns
```javascript
const report = generateWeeklyReport([]);
console.assert(report === null, 'Should return null for empty');
console.log('✅ Returns null when no vulnerabilities');
```

### Condition 5: Cron Job Registered
```bash
grep -q "WEEKLY_REPORT_CRON\|schedule.*weekly" src/infrastructure/scheduler.js
echo "✅ Cron job registered"
```

---

## Proof Required

Before marking VERIFIED, provide:

1. **File existence** (Condition 1-2)
2. **Node.js test output** (Condition 3-4)
3. **Grep output** (Condition 5)
4. **Manual test**: trigger email manually and verify:
   - Email sent to configured recipients
   - Contains correct vulnerability count
   - Grouped by severity
5. **Git diff** showing new files

---

## Proof of Verification

_To be filled in after implementation_

```
Condition 1: [✅/❌] Generator exists
Condition 2: [✅/❌] Email notifier exists
Condition 3: [✅/❌] Filtering works
Condition 4: [✅/❌] Returns null for empty
Condition 5: [✅/❌] Cron registered

Overall Status: TODO → IN_PROGRESS → VERIFIED ✅
Verified At: [timestamp]
Verified By: [name]
```

---

## Notes

- Only OPEN and ACKNOWLEDGED vulns included
- RESOLVED vulns excluded
- No email if zero vulns
- Cron default: Monday 9 AM (`0 9 * * 1`)
