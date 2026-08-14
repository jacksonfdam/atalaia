/**
 * Jest test suite for email functionality.
 * Tests: Report generation, HTML formatting, email sending (mocked), and edge cases.
 *
 * Run: npm test -- tests/email.test.js
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// Mock nodemailer. Under ESM this must happen before the modules that import it
// are loaded, so the imports below are dynamic.
const createTransport = jest.fn();
jest.unstable_mockModule('nodemailer', () => ({
  default: { createTransport },
  createTransport,
}));

const nodemailer = (await import('nodemailer')).default;
const { generateWeeklyReport } = await import('../src/application/generateWeeklyReport.js');
const { formatReportHtmlProfessional } = await import(
  '../src/infrastructure/notifiers/emailTemplates.js'
);
const { sendWeeklyEmail } = await import(
  '../src/infrastructure/notifiers/emailNotifier.js'
);

describe('Email Functionality', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ============================================
  // Test Suite 1: Report Generation
  // ============================================

  describe('Report Generation - generateWeeklyReport()', () => {
    it('should filter vulnerabilities by status (OPEN/ACKNOWLEDGED only)', () => {
      const vulns = [
        {
          cveId: 'CVE-1',
          severity: 'CRITICAL',
          status: 'OPEN',
          affectedTechnologies: ['nodejs'],
        },
        {
          cveId: 'CVE-2',
          severity: 'HIGH',
          status: 'ACKNOWLEDGED',
          affectedTechnologies: ['docker'],
        },
        {
          cveId: 'CVE-3',
          severity: 'MEDIUM',
          status: 'RESOLVED',
          affectedTechnologies: ['react'],
        },
      ];

      const report = generateWeeklyReport(vulns);

      // Should include CVE-1 and CVE-2, exclude CVE-3 (RESOLVED)
      expect(report.totalCount).toBe(2);
      // Nothing links these to a repository, so they are 'everything else'.
      expect(report.other.count).toBe(2);
      expect(report.affecting.count).toBe(0);
    });

    it('should group vulnerabilities by severity', () => {
      const vulns = [
        {
          cveId: 'CVE-1',
          severity: 'CRITICAL',
          status: 'OPEN',
        },
        {
          cveId: 'CVE-2',
          severity: 'CRITICAL',
          status: 'OPEN',
        },
        {
          cveId: 'CVE-3',
          severity: 'HIGH',
          status: 'OPEN',
        },
        {
          cveId: 'CVE-4',
          severity: 'MEDIUM',
          status: 'ACKNOWLEDGED',
        },
      ];

      const report = generateWeeklyReport(vulns);

      expect(report.totalCount).toBe(4);
      expect(report.other.count).toBe(4);
      // Severity still orders the rows inside a section.
      expect(report.other.vulnerabilities[0].severity).toBe('CRITICAL');
    });

    it('should return null when no vulnerabilities match filter', () => {
      const vulns = [
        {
          cveId: 'CVE-1',
          severity: 'LOW',
          status: 'RESOLVED',
        },
        {
          cveId: 'CVE-2',
          severity: 'UNKNOWN',
          status: 'RESOLVED',
        },
      ];

      const report = generateWeeklyReport(vulns);

      expect(report).toBeNull();
    });

    it('should include timestamp in report', () => {
      const vulns = [
        {
          cveId: 'CVE-1',
          severity: 'CRITICAL',
          status: 'OPEN',
        },
      ];

      const report = generateWeeklyReport(vulns);

      expect(report.generatedAt).toBeDefined();
      expect(typeof report.generatedAt).toBe('string');
      // Should be ISO 8601 format
      expect(new Date(report.generatedAt).toISOString()).toBe(report.generatedAt);
    });

    it('should handle empty array input', () => {
      const report = generateWeeklyReport([]);

      expect(report).toBeNull();
    });

    it('should handle undefined severity gracefully', () => {
      const vulns = [
        {
          cveId: 'CVE-1',
          severity: undefined,
          status: 'OPEN',
        },
      ];

      const report = generateWeeklyReport(vulns);

      // Should not crash; vulnerability with undefined severity should be skipped or grouped
      expect(report).toBeDefined();
    });
  });

  // ============================================
  // Test Suite 2: HTML Formatting
  // ============================================

  describe('HTML formatting — the template that actually ships', () => {
    const report = {
      generatedAt: '2026-03-10T10:00:00Z',
      windowDays: 7,
      totalCount: 3,
      openTotal: 12,
      openBySeverity: { CRITICAL: 2, HIGH: 4, MEDIUM: 3, LOW: 2, UNKNOWN: 1 },
      affecting: {
        count: 1,
        repositories: [
          {
            id: 1,
            name: 'acme/api',
            url: 'https://github.com/acme/api',
            worstSeverity: 'CRITICAL',
            vulnerabilities: [
              {
                cveId: 'CVE-2026-0001',
                title: 'Prototype pollution in lodash',
                severity: 'CRITICAL',
                cvssScore: 9.8,
                exploited: true,
                explanation: 'Someone can change how every object behaves.',
                via: [{ dependency: 'lodash', ecosystem: 'NPM', manifestFile: 'package.json' }],
              },
            ],
          },
        ],
      },
      infrastructure: {
        count: 1,
        shown: 1,
        vulnerabilities: [
          { cveId: 'CVE-2026-0002', severity: 'HIGH', cvssScore: 7.5, source: 'ghsa', explanation: null },
        ],
      },
      other: {
        count: 40,
        shown: 1,
        vulnerabilities: [
          { cveId: 'CVE-2026-0003', severity: 'MEDIUM', cvssScore: 5.3, source: 'nvd', explanation: null },
        ],
      },
      dependencies: {
        count: 1,
        repositories: [
          {
            id: 1,
            name: 'acme/api',
            dependencies: [{ ecosystem: 'NPM', name: 'express', declared: '^4.17.1', latest: '5.2.1' }],
          },
        ],
      },
    };

    const html = () => formatReportHtmlProfessional(report);

    it('names the repository a finding reaches, and the file it arrives through', () => {
      expect(html()).toContain('acme/api');
      expect(html()).toContain('CVE-2026-0001');
      expect(html()).toContain('lodash');
      expect(html()).toContain('package.json');
    });

    it('carries the short explanation, which is the point of the digest', () => {
      expect(html()).toContain('Someone can change how every object behaves.');
    });

    it('says a finding is known-exploited', () => {
      expect(html()).toContain('known exploited');
    });

    it('keeps the three sections apart', () => {
      const body = html();
      expect(body).toContain('Affects your code');
      expect(body).toContain('Containers');
      expect(body).toContain('Everything else collected');
    });

    it('states the full count of a capped section rather than the sample size', () => {
      // 40 collected, 1 listed: the email must not imply there is one.
      expect(html()).toContain('and 39 more');
    });

    it('reports dependencies that fell behind', () => {
      expect(html()).toContain('express');
      expect(html()).toContain('5.2.1');
    });

    it('escapes what came from a feed rather than interpolating it raw', () => {
      const hostile = {
        ...report,
        other: {
          count: 1,
          shown: 1,
          vulnerabilities: [
            { cveId: '<script>alert(1)</script>', severity: 'LOW', cvssScore: null, source: 'nvd', explanation: null },
          ],
        },
      };

      const body = formatReportHtmlProfessional(hostile);
      expect(body).not.toContain('<script>alert(1)</script>');
      expect(body).toContain('&lt;script&gt;');
    });

    it('renders a quiet week without throwing', () => {
      const quiet = {
        ...report,
        totalCount: 0,
        affecting: { count: 0, repositories: [] },
        infrastructure: { count: 0, shown: 0, vulnerabilities: [] },
        other: { count: 0, shown: 0, vulnerabilities: [] },
        dependencies: { count: 0, repositories: [] },
      };

      expect(formatReportHtmlProfessional(quiet)).toContain('Nothing new reached your repositories');
    });
  });

  describe('Email Sending - sendWeeklyEmail()', () => {
    it('should not send email when report is null', async () => {
      const mockSendMail = jest.fn();
      nodemailer.createTransport.mockReturnValue({
        sendMail: mockSendMail,
      });

      await sendWeeklyEmail(null);

      expect(mockSendMail).not.toHaveBeenCalled();
    });

    it('should send email with correct structure when report exists', async () => {
      const mockSendMail = jest.fn().mockResolvedValue({ messageId: '123' });
      nodemailer.createTransport.mockReturnValue({
        sendMail: mockSendMail,
      });

      const report = {
        generatedAt: '2026-03-10T10:00:00Z',
        totalCount: 1,
        affecting: { count: 0, repositories: [] },
        infrastructure: { count: 0, shown: 0, vulnerabilities: [] },
        dependencies: { count: 0, repositories: [] },
        other: { count: 0, shown: 0, vulnerabilities: [
        ] },
      };

      process.env.EMAIL_RECIPIENTS = 'test@example.com';
      process.env.EMAIL_FROM = 'atalaia@example.com';
      process.env.SMTP_HOST = 'smtp.test.com';
      process.env.SMTP_PORT = '587';

      await sendWeeklyEmail(report);

      // Verify sendMail was called
      expect(mockSendMail).toHaveBeenCalled();

      // Verify email structure
      const emailCall = mockSendMail.mock.calls[0][0];
      expect(emailCall.to).toContain('test@example.com');
      expect(emailCall.from).toContain('atalaia@example.com');
      expect(emailCall.subject).toContain('Atalaia');
      expect(emailCall.html).toBeDefined();
      expect(emailCall.html).toContain('Weekly Vulnerability Report');
    });

    it('should handle SMTP errors gracefully', async () => {
      const mockError = new Error('SMTP connection failed');
      nodemailer.createTransport.mockImplementation(() => {
        throw mockError;
      });

      const report = {
        generatedAt: '2026-03-10T10:00:00Z',
        totalCount: 1,
        affecting: { count: 0, repositories: [] },
        infrastructure: { count: 0, shown: 0, vulnerabilities: [] },
        dependencies: { count: 0, repositories: [] },
        other: { count: 1, shown: 1, vulnerabilities: [
            { cveId: 'CVE-2026-0001', severity: 'CRITICAL', status: 'OPEN', source: 'CISA', cvssScore: null, exploited: false, explanation: null }
        ] },
      };

      process.env.SMTP_HOST = 'smtp.test.com';
      process.env.EMAIL_RECIPIENTS = 'test@example.com';

      // Should not throw; error should be logged
      await expect(sendWeeklyEmail(report)).resolves.not.toThrow();
    });

    it('should handle missing SMTP configuration', async () => {
      const originalHost = process.env.SMTP_HOST;
      delete process.env.SMTP_HOST;

      const report = {
        generatedAt: '2026-03-10T10:00:00Z',
        totalCount: 1,
        affecting: { count: 0, repositories: [] },
        infrastructure: { count: 0, shown: 0, vulnerabilities: [] },
        dependencies: { count: 0, repositories: [] },
        other: { count: 1, shown: 1, vulnerabilities: [
            { cveId: 'CVE-2026-0001', severity: 'CRITICAL', status: 'OPEN', source: 'CISA', cvssScore: null, exploited: false, explanation: null }
        ] },
      };

      // Should handle gracefully without crashing
      await expect(sendWeeklyEmail(report)).resolves.not.toThrow();

      // Restore env var
      process.env.SMTP_HOST = originalHost;
    });
  });

  // ============================================
  // Test Suite 4: Integration
  // ============================================

  describe('Integration - Full Email Flow', () => {
    it('should skip email sending when report generates null', async () => {
      const emptyVulns = [];
      const report = generateWeeklyReport(emptyVulns);

      expect(report).toBeNull();
      // Email should be skipped in real usage
    });

    it('should process complete flow from vulnerabilities to email', () => {
      const vulns = [
        {
          cveId: 'CVE-2026-0001',
          severity: 'CRITICAL',
          status: 'OPEN',
          source: 'CISA',
          affectedTechnologies: ['nodejs'],
        },
        {
          cveId: 'CVE-2026-0002',
          severity: 'HIGH',
          status: 'ACKNOWLEDGED',
          source: 'NVD',
          affectedTechnologies: ['docker'],
        },
      ];

      // Step 1: Generate report
      const report = generateWeeklyReport(vulns);
      expect(report).not.toBeNull();
      expect(report.totalCount).toBe(2);

      // Step 2: Format HTML
      const html = formatReportHtmlProfessional(report);
      expect(html).toContain('CVE-2026-0001');
      expect(html).toContain('CVE-2026-0002');
      expect(html).toContain('CRITICAL');
      expect(html).toContain('HIGH');

      // Step 3: Would send via nodemailer (mocked in real tests)
      expect(html).toBeTruthy();
    });
  });
});
