#!/usr/bin/env node
/**
 * Manual test script for email sending functionality.
 * Quickly verify weekly email reports work without running the full app.
 *
 * Usage:
 *   node tests/manual/test-email-manual.js
 *
 * Setup:
 *   1. Sign up for free Mailtrap account: https://mailtrap.io
 *   2. Create a test inbox
 *   3. Get SMTP credentials and add to .env:
 *      SMTP_HOST=smtp.mailtrap.io
 *      SMTP_PORT=2525
 *      SMTP_USER=<mailtrap-user>
 *      SMTP_PASS=<mailtrap-pass>
 *      EMAIL_FROM=atalaia@example.com
 *      EMAIL_RECIPIENTS=test@example.com
 *   4. Run this script: node tests/manual/test-email-manual.js
 *   5. Check Mailtrap inbox for the test email
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createRequire } from 'module';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '../..');

// Dynamic imports for modules
const { generateWeeklyReport } = await import(
  `${projectRoot}/src/application/generateWeeklyReport.js`
);

const { sendWeeklyEmail } = await import(
  `${projectRoot}/src/infrastructure/notifiers/emailNotifier.js`
);

const logger = (await import(`${projectRoot}/src/infrastructure/logger.js`))
  .default;

const { getAll } = await import(
  `${projectRoot}/src/infrastructure/cache/sqliteCache.js`
);

// Color output helpers
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[36m',
};

function log(color, ...args) {
  console.log(`${colors[color]}${new Date().toISOString()} [TEST]${colors.reset}`, ...args);
}

async function testEmailSending() {
  log('blue', '========================================');
  log('blue', 'Email Sending Manual Test');
  log('blue', '========================================\n');

  // Step 1: Verify SMTP configuration
  log('blue', '📧 Step 1: Checking SMTP Configuration...');
  const smtpConfig = {
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,
    user: process.env.SMTP_USER ? '***' : 'not set',
    pass: process.env.SMTP_PASS ? '***' : 'not set',
    from: process.env.EMAIL_FROM,
    recipients: process.env.EMAIL_RECIPIENTS,
  };

  console.log('SMTP Config:', smtpConfig);

  if (!process.env.SMTP_HOST || !process.env.EMAIL_RECIPIENTS) {
    log('red', '❌ Missing required SMTP configuration!');
    log('yellow', 'Please add to .env:');
    console.log(`
  SMTP_HOST=smtp.mailtrap.io
  SMTP_PORT=2525
  SMTP_USER=<your-mailtrap-user>
  SMTP_PASS=<your-mailtrap-pass>
  EMAIL_FROM=atalaia@example.com
  EMAIL_RECIPIENTS=test@example.com
    `);
    process.exit(1);
  }

  log('green', '✓ SMTP configuration found\n');

  // Step 2: Fetch vulnerabilities
  log('blue', '📦 Step 2: Fetching vulnerabilities from cache...');
  try {
    const vulnerabilities = getAll();
    log('green', `✓ Found ${vulnerabilities.length} vulnerabilities in cache\n`);

    if (vulnerabilities.length === 0) {
      log('yellow', '⚠️  No vulnerabilities in cache. Generating sample data for testing...\n');
      // Create sample vulnerabilities for testing
      const sampleVulns = [
        {
          cveId: 'CVE-2024-0001',
          cve_id: 'CVE-2024-0001',
          title: 'Test Critical Vulnerability',
          description: 'This is a test critical vulnerability',
          severity: 'CRITICAL',
          cvssScore: 9.8,
          source: 'test-source',
          status: 'OPEN',
          affectedTechnologies: ['nodejs', 'npm'],
        },
        {
          cveId: 'CVE-2024-0002',
          cve_id: 'CVE-2024-0002',
          title: 'Test High Vulnerability',
          description: 'This is a test high severity vulnerability',
          severity: 'HIGH',
          cvssScore: 7.5,
          source: 'test-source',
          status: 'ACKNOWLEDGED',
          affectedTechnologies: ['docker'],
        },
        {
          cveId: 'CVE-2024-0003',
          cve_id: 'CVE-2024-0003',
          title: 'Test Medium Vulnerability',
          description: 'This is a test medium severity vulnerability',
          severity: 'MEDIUM',
          cvssScore: 5.5,
          source: 'test-source',
          status: 'OPEN',
          affectedTechnologies: ['react'],
        },
      ];

      return testWithSampleData(sampleVulns);
    }

    // Step 3: Generate report
    log('blue', '📋 Step 3: Generating weekly report...');
    const report = generateWeeklyReport(vulnerabilities);

    if (!report) {
      log('yellow', '⚠️  No report generated (no OPEN/ACKNOWLEDGED vulnerabilities)');
      log('yellow', 'Skipping email send. This is expected behavior.\n');
      log('blue', '========================================');
      log('green', '✓ Test completed successfully');
      log('blue', '========================================\n');
      return;
    }

    log('green', `✓ Report generated with ${report.totalCount} vulnerabilities`);
    console.log('Report summary:', {
      generatedAt: report.generatedAt,
      totalCount: report.totalCount,
      severityGroups: Object.keys(report.vulnerabilities).filter(
        (s) => report.vulnerabilities[s].length > 0
      ),
    });
    console.log('');

    // Step 4: Send email
    log('blue', '📬 Step 4: Sending test email...');
    await sendWeeklyEmail(report);
    log('green', '✓ Email send request completed\n');

    // Step 5: Success message
    log('blue', '========================================');
    log('green', '✓ Test completed successfully!');
    log('blue', '========================================\n');

    log('yellow', '📬 Check your Mailtrap inbox:');
    log('yellow', '   https://mailtrap.io\n');

    log('yellow', 'You should see an email with:');
    log('yellow', '   • Subject: Weekly Vulnerability Report');
    log('yellow', `   • Recipient: ${process.env.EMAIL_RECIPIENTS}`);
    log('yellow', `   • Content: ${report.totalCount} vulnerabilities grouped by severity\n`);
  } catch (error) {
    log('red', '❌ Error during test:');
    console.error(error);
    process.exit(1);
  }
}

async function testWithSampleData(sampleVulns) {
  log('green', `✓ Created ${sampleVulns.length} sample vulnerabilities for testing\n`);

  // Step 3: Generate report
  log('blue', '📋 Step 3: Generating weekly report...');
  const report = generateWeeklyReport(sampleVulns);

  if (!report) {
    log('red', '❌ Failed to generate report!');
    process.exit(1);
  }

  log('green', `✓ Report generated with ${report.totalCount} vulnerabilities`);
  console.log('Report summary:', {
    generatedAt: report.generatedAt,
    totalCount: report.totalCount,
    severityGroups: Object.keys(report.vulnerabilities).filter(
      (s) => report.vulnerabilities[s].length > 0
    ),
  });
  console.log('');

  // Step 4: Send email
  log('blue', '📬 Step 4: Sending test email with sample data...');
  try {
    await sendWeeklyEmail(report);
    log('green', '✓ Email send request completed\n');
  } catch (error) {
    log('red', '❌ Error sending email:');
    console.error(error);
    process.exit(1);
  }

  // Step 5: Success message
  log('blue', '========================================');
  log('green', '✓ Test completed successfully!');
  log('blue', '========================================\n');

  log('yellow', '📬 Check your Mailtrap inbox:');
  log('yellow', '   https://mailtrap.io\n');

  log('yellow', 'You should see an email with:');
  log('yellow', '   • Subject: Weekly Vulnerability Report');
  log('yellow', `   • Recipient: ${process.env.EMAIL_RECIPIENTS}`);
  log('yellow', `   • Content: ${report.totalCount} test vulnerabilities grouped by severity\n`);
}

// Run the test
testEmailSending().catch((error) => {
  log('red', 'Unexpected error:');
  console.error(error);
  process.exit(1);
});
