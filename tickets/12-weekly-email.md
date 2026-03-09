# Ticket #12: Weekly Email Reports

**Status:** TODO (Updated with email service options)
**Verified:** ❌ (Requires re-verification with new email services)
**Depends On:** #6 (Status Lifecycle)
**Blocks:** None
**Priority:** LOW

---

## Task Description

Add weekly email reports grouped by severity containing all OPEN and ACKNOWLEDGED vulnerabilities.

### What Needs to Be Built

1. **`src/application/generateWeeklyReport.js`** — Generate report data
2. **`src/infrastructure/notifiers/emailNotifier.js`** — Send via Mailtrap, SendGrid, or SMTP
3. **Add cron job** — Scheduled weekly (configurable, default Monday 9 AM)
4. **Email service abstraction** — Support for multiple providers (Mailtrap, SendGrid, SMTP)

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
- [ ] Email service configurable via `EMAIL_SERVICE` env var: `mailtrap` | `sendgrid` | `smtp` (default: `smtp`)
- [ ] **Mailtrap support:** Uses API key or SMTP credentials for sending
- [ ] **SendGrid support:** Uses API key for sending via REST API
- [ ] **SMTP support:** Direct SMTP server configuration (host, port, user, pass)
- [ ] Scheduled via cron (`WEEKLY_REPORT_CRON`, default: Monday 9 AM)
- [ ] Email includes recipient addresses from config
- [ ] Professional HTML format with severity grouping
- [ ] No email sent if no vulnerabilities
- [ ] Service selection validated and logged

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

### Step 2: Create Email Notifier (Multi-Service Support)

`src/infrastructure/notifiers/emailNotifier.js`:
```javascript
import nodemailer from 'nodemailer';
import axios from 'axios';
import logger from '../logger.js';

const EMAIL_SERVICE = process.env.EMAIL_SERVICE || 'smtp';

export async function sendWeeklyEmail(report, config) {
  if (!report) {
    logger.info('No vulnerabilities for weekly report');
    return;
  }

  const html = formatReportHtml(report);
  const recipients = config.EMAIL_RECIPIENTS.split(',').map(e => e.trim());
  const subject = `Weekly Vulnerability Report - ${new Date().toLocaleDateString()}`;
  const vulnCount = countVulns(report);

  try {
    switch (EMAIL_SERVICE.toLowerCase()) {
      case 'mailtrap':
        await sendViaMailtrap(config, recipients, subject, html);
        break;
      case 'sendgrid':
        await sendViaSendGrid(config, recipients, subject, html);
        break;
      case 'smtp':
      default:
        await sendViaSMTP(config, recipients, subject, html);
    }

    logger.info({ service: EMAIL_SERVICE, count: vulnCount, recipients }, 'Weekly email sent');
  } catch (error) {
    logger.error({ service: EMAIL_SERVICE, error: error.message }, 'Failed to send weekly email');
  }
}

async function sendViaMailtrap(config, recipients, subject, html) {
  // Mailtrap uses SMTP or API - using SMTP for simplicity
  const transporter = nodemailer.createTransport({
    host: config.MAILTRAP_SMTP_HOST || 'smtp.mailtrap.io',
    port: config.MAILTRAP_SMTP_PORT || 2525,
    auth: {
      user: config.MAILTRAP_USER,
      pass: config.MAILTRAP_PASS
    }
  });

  await transporter.sendMail({
    from: config.EMAIL_FROM,
    to: recipients.join(','),
    subject,
    html
  });
}

async function sendViaSendGrid(config, recipients, subject, html) {
  const sgApiKey = config.SENDGRID_API_KEY;

  await axios.post('https://api.sendgrid.com/v3/mail/send', {
    personalizations: recipients.map(to => ({ to: [{ email: to }] })),
    from: { email: config.EMAIL_FROM },
    subject,
    content: [{ type: 'text/html', value: html }]
  }, {
    headers: {
      'Authorization': `Bearer ${sgApiKey}`,
      'Content-Type': 'application/json'
    }
  });
}

async function sendViaSMTP(config, recipients, subject, html) {
  const transporter = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_PORT === 465,
    auth: {
      user: config.SMTP_USER,
      pass: config.SMTP_PASS
    }
  });

  await transporter.sendMail({
    from: config.EMAIL_FROM,
    to: recipients.join(','),
    subject,
    html
  });
}

function formatReportHtml(report) {
  let html = `
    <html>
      <head><style>
        h2 { color: #333; }
        h3 { color: #666; margin-top: 20px; }
        .critical { color: #dc3545; }
        .high { color: #fd7e14; }
        .medium { color: #ffc107; }
        .low { color: #28a745; }
        ul { list-style: none; padding-left: 0; }
        li { padding: 10px; border-left: 3px solid #ddd; margin: 5px 0; }
      </style></head>
      <body>
        <h2>Weekly Vulnerability Report</h2>
        <p>Report generated: ${new Date().toLocaleString()}</p>
  `;

  Object.entries(report.vulnerabilities).forEach(([severity, vulns]) => {
    if (vulns.length === 0) return;

    const className = severity.toLowerCase();
    html += `<h3 class="${className}">${severity} (${vulns.length})</h3><ul>`;
    vulns.forEach(v => {
      html += `<li><strong>${v.cveId}</strong>: ${v.title}<br/><small>Technologies: ${v.affectedTechnologies.join(', ')}</small></li>`;
    });
    html += '</ul>';
  });

  html += '</body></html>';
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

### Condition 5: Email Service Selection Works
```bash
# Test each service with appropriate env var
EMAIL_SERVICE=mailtrap node --input-type=module << 'EOF'
import { sendWeeklyEmail } from './src/infrastructure/notifiers/emailNotifier.js';
console.log('✅ Mailtrap service loads');
EOF

EMAIL_SERVICE=sendgrid node --input-type=module << 'EOF'
import { sendWeeklyEmail } from './src/infrastructure/notifiers/emailNotifier.js';
console.log('✅ SendGrid service loads');
EOF

EMAIL_SERVICE=smtp node --input-type=module << 'EOF'
import { sendWeeklyEmail } from './src/infrastructure/notifiers/emailNotifier.js';
console.log('✅ SMTP service loads');
EOF
```

### Condition 6: Cron Job Registered
```bash
grep -q "WEEKLY_REPORT_CRON\|schedule.*weekly" src/infrastructure/scheduler.js
echo "✅ Cron job registered"
```

### Condition 7: All Email Services Supported
```bash
grep -q "sendViaMailtrap\|sendViaSendGrid\|sendViaSMTP" src/infrastructure/notifiers/emailNotifier.js
echo "✅ All three email services implemented"
```

---

## Proof Required

Before marking VERIFIED, provide:

1. **File existence** (Condition 1-2)
2. **Node.js test output** (Condition 3-4)
3. **Grep output** for service support (Condition 5, 7)
4. **Cron job registration output** (Condition 6)
5. **Manual tests** for each email service (mailtrap, sendgrid, smtp):
   - Email sent to configured recipients
   - Contains correct vulnerability count
   - Grouped by severity with proper HTML styling
   - Service-specific credentials verified
6. **Environment variable test output** showing:
   - Default EMAIL_SERVICE behavior (SMTP)
   - Mailtrap configuration loads correctly
   - SendGrid API key validation
7. **Git diff** showing new files and updated config

---

## Proof of Verification

_To be filled in after implementation_

```
Condition 1: [✅/❌] Generator exists
Condition 2: [✅/❌] Email notifier exists
Condition 3: [✅/❌] Filtering works
Condition 4: [✅/❌] Returns null for empty
Condition 5: [✅/❌] Email service selection (mailtrap, sendgrid, smtp)
Condition 6: [✅/❌] Cron registered
Condition 7: [✅/❌] All three email services implemented

Service-Specific Verification:
- [✅/❌] Mailtrap: Credentials configured and tested
- [✅/❌] SendGrid: API key validated and tested
- [✅/❌] SMTP: Direct server configuration working

Overall Status: TODO → IN_PROGRESS → VERIFIED ✅
Verified At: [timestamp]
Verified By: [name]
```

---

## Notes

### Email Service Selection

**SMTP (Default)**
- Use for self-hosted mail servers or local development
- Requires: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`
- Most flexible but requires server access

**Mailtrap** (Recommended for Testing)
- Free tier with 100 emails/day
- Use SMTP credentials: `MAILTRAP_SMTP_HOST`, `MAILTRAP_USER`, `MAILTRAP_PASS`
- Or API key method for production
- Set `EMAIL_SERVICE=mailtrap`
- Signup: https://mailtrap.io

**SendGrid** (Recommended for Production)
- Industry standard, high deliverability
- Requires: `SENDGRID_API_KEY`
- Set `EMAIL_SERVICE=sendgrid`
- Uses REST API (no SMTP needed)
- Signup: https://sendgrid.com

### Vulnerability Filtering
- Only OPEN and ACKNOWLEDGED vulns included
- RESOLVED vulns excluded
- No email if zero vulns
- Cron default: Monday 9 AM (`0 9 * * 1`)

### Configuration Priority
1. Check `EMAIL_SERVICE` env var
2. Fall back to SMTP if not set
3. Each service validates required credentials before sending

### HTML Formatting
- Severity-based color coding (Critical=red, High=orange, Medium=yellow, Low=green)
- Responsive design
- Includes generation timestamp
