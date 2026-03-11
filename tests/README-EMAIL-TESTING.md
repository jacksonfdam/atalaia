# Email Testing Guide

This guide explains how to set up and test the weekly vulnerability email reports in Atalaia.

## Quick Start (5 minutes)

### 1. Create a Mailtrap Test Account

Mailtrap provides a free sandbox SMTP server perfect for testing emails without sending real emails.

1. Go to https://mailtrap.io and sign up for a free account
2. Create a new **Test Inbox**
3. Go to **Settings** and copy the **SMTP Credentials**

### 2. Configure Environment Variables

Add these to your `.env` file:

```bash
# Email Configuration (from Mailtrap)
SMTP_HOST=smtp.mailtrap.io
SMTP_PORT=2525
SMTP_USER=<your-mailtrap-username>
SMTP_PASS=<your-mailtrap-password>
EMAIL_FROM=atalaia@example.com
EMAIL_RECIPIENTS=test@example.com

# Weekly Report Schedule (for testing, use every 5 minutes)
WEEKLY_REPORT_CRON=*/5 * * * *
# WEEKLY_REPORT_CRON=0 9 * * 1   # Use this for production (Monday 9 AM)
```

### 3. Run the Manual Test

```bash
node tests/manual/test-email-manual.js
```

Expected output:
```
📧 Step 1: Checking SMTP Configuration...
✓ SMTP configuration found

📦 Step 2: Fetching vulnerabilities from cache...
✓ Found 123 vulnerabilities in cache

📋 Step 3: Generating weekly report...
✓ Report generated with 45 vulnerabilities

📬 Step 4: Sending test email...
✓ Email send request completed

========================================
✓ Test completed successfully!
========================================

📬 Check your Mailtrap inbox:
   https://mailtrap.io

You should see an email with:
   • Subject: Weekly Vulnerability Report
   • Recipient: test@example.com
   • Content: 45 vulnerabilities grouped by severity
```

4. Check your Mailtrap inbox at https://mailtrap.io to see the test email

## Testing Options

### Option A: Manual Test Script (Fastest)

Run the test script without starting the full app:

```bash
node tests/manual/test-email-manual.js
```

**Pros:**
- Quick verification (takes 5-10 seconds)
- No need to run full app
- See immediate results in Mailtrap
- Works with or without existing vulnerabilities in cache

**Cons:**
- One-time test only

### Option B: Automated Jest Tests

Run the Jest test suite:

```bash
npm test -- tests/email.test.js
```

**Test Coverage:**
- Report generation filters by status (OPEN/ACKNOWLEDGED)
- Severity grouping (CRITICAL, HIGH, MEDIUM, LOW)
- HTML formatting and table structure
- Email sending via mocked SMTP
- Edge cases (null report, missing config, etc.)

**Example output:**
```
PASS  tests/email.test.js
  Email Functionality
    Report Generation - generateWeeklyReport()
      ✓ should filter vulnerabilities by status (OPEN/ACKNOWLEDGED only) (5 ms)
      ✓ should group vulnerabilities by severity (2 ms)
      ✓ should return null when no vulnerabilities match filter (1 ms)
      ✓ should include timestamp in report (1 ms)
      ✓ should handle empty array input (1 ms)
      ✓ should handle undefined severity gracefully (1 ms)
    HTML Formatting - formatReportHtml()
      ✓ should generate valid HTML with proper structure (2 ms)
      ✓ should handle camelCase field names (cveId) (1 ms)
      ✓ should handle snake_case field names (cve_id) (1 ms)
      ✓ should skip severity groups with no vulnerabilities (1 ms)
    Email Sending - sendWeeklyEmail()
      ✓ should not send email when report is null (1 ms)
      ✓ should send email with correct structure (2 ms)
      ✓ should handle SMTP errors gracefully (1 ms)
      ✓ should handle missing SMTP configuration (1 ms)
    Integration - Full Email Flow
      ✓ should skip email sending when report generates null (1 ms)
      ✓ should process complete flow from vulnerabilities to email (2 ms)

Test Suites: 1 passed, 1 total
Tests:       16 passed, 16 total
```

### Option C: Scheduler Trigger (End-to-End)

Test the full integration with the scheduler:

1. Update `.env`:
```bash
WEEKLY_REPORT_CRON=*/5 * * * *   # Every 5 minutes (for testing)
SMTP_HOST=smtp.mailtrap.io
SMTP_PORT=2525
SMTP_USER=<your-mailtrap-username>
SMTP_PASS=<your-mailtrap-password>
EMAIL_FROM=atalaia@example.com
EMAIL_RECIPIENTS=test@example.com
```

2. Start the app:
```bash
npm run dev
```

3. Wait 5 minutes for the scheduler to trigger

4. Check logs for confirmation:
```
[INFO] Running weekly report generation
[INFO] Weekly email sent
```

5. Check your Mailtrap inbox

**Pros:**
- Tests the full integration (scheduler + report + email)
- Most realistic scenario

**Cons:**
- Takes 5+ minutes to run
- Requires app to be running

## What Gets Tested

### Report Generation
- ✅ Filters vulnerabilities by status (OPEN/ACKNOWLEDGED only, excludes RESOLVED)
- ✅ Groups by severity (CRITICAL → HIGH → MEDIUM → LOW)
- ✅ Includes total count and timestamp
- ✅ Returns null if no matching vulnerabilities (email is skipped)

### Email Content
- ✅ HTML table with proper structure
- ✅ Columns: CVE ID | Status | Source | Technologies
- ✅ Vulnerabilities grouped by severity sections
- ✅ Handles both camelCase (`cveId`) and snake_case (`cve_id`) field names
- ✅ Handles both array and string formats for technologies
- ✅ Includes header with total count and timestamp

### SMTP Configuration
- ✅ Supports TLS (port 587) and SSL (port 465)
- ✅ Optional authentication (for open relay servers)
- ✅ Comma-separated recipient list support
- ✅ Graceful error handling (logs error, doesn't crash app)

### Email Sending
- ✅ Skips email if no vulnerabilities found
- ✅ Skips email if SMTP not configured
- ✅ Handles SMTP connection errors gracefully
- ✅ Logs success/failure with details

## Troubleshooting

### Issue: "Missing required SMTP configuration"

**Solution:**
Make sure your `.env` file has:
```
SMTP_HOST=smtp.mailtrap.io
SMTP_PORT=2525
SMTP_USER=<mailtrap-username>
SMTP_PASS=<mailtrap-password>
EMAIL_RECIPIENTS=your-email@example.com
```

Get credentials from Mailtrap Dashboard → Inbox Settings → SMTP Settings

### Issue: Email not appearing in Mailtrap

**Check:**
1. SMTP credentials are correct (copy from Mailtrap settings)
2. Email recipient is set (`EMAIL_RECIPIENTS`)
3. There are vulnerabilities in the cache with status OPEN or ACKNOWLEDGED
4. Check app logs for SMTP errors

**Debug:**
Run the manual test with verbose logging:
```bash
node tests/manual/test-email-manual.js 2>&1 | grep -A 5 "Step 4"
```

### Issue: "No vulnerabilities for weekly report"

**Explanation:**
The email is skipped when:
- No vulnerabilities in the cache
- All vulnerabilities have status RESOLVED
- All vulnerabilities have status other than OPEN/ACKNOWLEDGED

**Solution:**
1. Run the vulnerability monitor first: `npm run dev`
2. Wait for feeds to populate the cache
3. Check dashboard or database for vulnerabilities with OPEN/ACKNOWLEDGED status

### Issue: "ECONNREFUSED 127.0.0.1:2525"

**Explanation:**
Cannot connect to SMTP server. May be network or firewall issue.

**Solutions:**
1. Verify SMTP_HOST is correct: `smtp.mailtrap.io`
2. Verify SMTP_PORT is correct: `2525`
3. Check internet connection
4. Check firewall rules (Mailtrap should allow port 2525)
5. Try a different port (Mailtrap supports 465, 25, 2525, 587)

## Email Report Format

The weekly email includes:

**Subject:** Atalaia Weekly Vulnerability Report — 3/10/2026

**Body:**
```
Weekly Vulnerability Report

Generated: 2026-03-10T10:00:00Z

Total open/acknowledged vulnerabilities: 45

CRITICAL (5)
CVE ID            | Status       | Source | Technologies
CVE-2026-0001     | OPEN         | CISA   | nodejs, npm
...

HIGH (12)
...

MEDIUM (20)
...

LOW (8)
...
```

## Configuration Reference

### SMTP Settings

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SMTP_HOST` | ✓ | None | SMTP server hostname |
| `SMTP_PORT` | ✗ | 587 | SMTP port (587 for TLS, 465 for SSL) |
| `SMTP_USER` | ✗ | None | SMTP username (if auth required) |
| `SMTP_PASS` | ✗ | None | SMTP password (if auth required) |
| `EMAIL_FROM` | ✗ | atalaia@localhost | Sender email address |
| `EMAIL_RECIPIENTS` | ✓ | None | Comma-separated recipient list |

### Schedule Settings

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `WEEKLY_REPORT_CRON` | ✗ | "0 9 * * 1" | Cron schedule (Monday 9 AM) |

### Cron Format

```
┌───────────── minute (0 - 59)
│ ┌───────────── hour (0 - 23)
│ │ ┌───────────── day of month (1 - 31)
│ │ │ ┌───────────── month (1 - 12)
│ │ │ │ ┌───────────── day of week (0 - 7, 0 and 7 are Sunday)
│ │ │ │ │
│ │ │ │ │
* * * * *

Examples:
"0 9 * * 1"      - Monday 9:00 AM
"0 18 * * *"     - Every day 6:00 PM
"*/5 * * * *"    - Every 5 minutes (for testing)
"0 9 1 * *"      - 1st of each month at 9:00 AM
```

## Next Steps

1. ✅ Run manual test to verify email sending works
2. ✅ Run Jest tests to verify report generation
3. ✅ Test full scheduler integration (optional)
4. ✅ Update production cron schedule: `WEEKLY_REPORT_CRON=0 9 * * 1`
5. ✅ Update production email list: `EMAIL_RECIPIENTS=team@company.com,security@company.com`
6. ✅ Switch SMTP to production service (SendGrid, AWS SES, corporate SMTP, etc.)

## Additional Resources

- **Mailtrap Documentation:** https://mailtrap.io/documentation
- **Node-cron Documentation:** https://github.com/kelektiv/node-cron
- **Nodemailer Documentation:** https://nodemailer.com/
- **Cron Expression Generator:** https://crontab.guru/
