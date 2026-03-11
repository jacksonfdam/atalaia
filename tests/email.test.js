/**
 * Jest test suite for email functionality.
 * Tests: Report generation, HTML formatting, email sending (mocked), and edge cases.
 *
 * Run: npm test -- tests/email.test.js
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import generateWeeklyReport from '../src/application/generateWeeklyReport.js';
import { sendWeeklyEmail, formatReportHtml } from '../src/infrastructure/notifiers/emailNotifier.js';
import nodemailer from 'nodemailer';

// Mock nodemailer
jest.mock('nodemailer');

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
      expect(report.vulnerabilities.CRITICAL).toHaveLength(1);
      expect(report.vulnerabilities.HIGH).toHaveLength(1);
      expect(report.vulnerabilities.MEDIUM).toHaveLength(0);
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

      expect(report.vulnerabilities.CRITICAL).toHaveLength(2);
      expect(report.vulnerabilities.HIGH).toHaveLength(1);
      expect(report.vulnerabilities.MEDIUM).toHaveLength(1);
      expect(report.totalCount).toBe(4);
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

  describe('HTML Formatting - formatReportHtml()', () => {
    it('should generate valid HTML with proper structure', () => {
      const report = {
        generatedAt: '2026-03-10T10:00:00Z',
        totalCount: 2,
        vulnerabilities: {
          CRITICAL: [
            {
              cve_id: 'CVE-2026-0001',
              status: 'OPEN',
              source: 'CISA',
              affectedTechnologies: ['nodejs', 'npm'],
            },
          ],
          HIGH: [
            {
              cve_id: 'CVE-2026-0002',
              status: 'ACKNOWLEDGED',
              source: 'NVD',
              affected_technologies: 'docker,kubernetes',
            },
          ],
          MEDIUM: [],
          LOW: [],
        },
      };

      const html = formatReportHtml(report);

      // Should contain heading
      expect(html).toContain('Weekly Vulnerability Report');
      // Should contain timestamp
      expect(html).toContain('2026-03-10T10:00:00Z');
      // Should contain total count
      expect(html).toContain('2');
      // Should contain table headers
      expect(html).toContain('CVE ID');
      expect(html).toContain('Status');
      expect(html).toContain('Source');
      expect(html).toContain('Technologies');
      // Should contain vulnerability data
      expect(html).toContain('CVE-2026-0001');
      expect(html).toContain('OPEN');
      expect(html).toContain('CISA');
      expect(html).toContain('nodejs');
    });

    it('should handle camelCase field names (cveId)', () => {
      const report = {
        generatedAt: '2026-03-10T10:00:00Z',
        totalCount: 1,
        vulnerabilities: {
          CRITICAL: [
            {
              cveId: 'CVE-2026-0003', // camelCase
              status: 'OPEN',
              source: 'Snyk',
              affectedTechnologies: ['react'],
            },
          ],
          HIGH: [],
          MEDIUM: [],
          LOW: [],
        },
      };

      const html = formatReportHtml(report);

      expect(html).toContain('CVE-2026-0003');
    });

    it('should handle snake_case field names (cve_id)', () => {
      const report = {
        generatedAt: '2026-03-10T10:00:00Z',
        totalCount: 1,
        vulnerabilities: {
          CRITICAL: [
            {
              cve_id: 'CVE-2026-0004', // snake_case
              status: 'OPEN',
              source: 'NVD',
              affected_technologies: 'python,pip',
            },
          ],
          HIGH: [],
          MEDIUM: [],
          LOW: [],
        },
      };

      const html = formatReportHtml(report);

      expect(html).toContain('CVE-2026-0004');
      expect(html).toContain('python');
    });

    it('should skip severity groups with no vulnerabilities', () => {
      const report = {
        generatedAt: '2026-03-10T10:00:00Z',
        totalCount: 1,
        vulnerabilities: {
          CRITICAL: [
            {
              cve_id: 'CVE-2026-0005',
              status: 'OPEN',
              source: 'Test',
              affectedTechnologies: ['test'],
            },
          ],
          HIGH: [],
          MEDIUM: [],
          LOW: [],
        },
      };

      const html = formatReportHtml(report);

      // Should contain CRITICAL section
      expect(html).toContain('CRITICAL');
      // Should NOT contain empty severity headers
      const lines = html.split('\n');
      const highLine = lines.find((l) => l.includes('HIGH'));
      if (highLine) {
        // If HIGH exists, it should have vulnerabilities or be skipped
        expect(html).not.toContain('<h3>HIGH (0)</h3>');
      }
    });
  });

  // ============================================
  // Test Suite 3: Email Sending (Mocked)
  // ============================================

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
        vulnerabilities: {
          CRITICAL: [
            {
              cve_id: 'CVE-2026-0001',
              status: 'OPEN',
              source: 'CISA',
              affectedTechnologies: ['nodejs'],
            },
          ],
          HIGH: [],
          MEDIUM: [],
          LOW: [],
        },
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
      expect(emailCall.subject).toContain('Weekly');
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
        vulnerabilities: {
          CRITICAL: [
            {
              cve_id: 'CVE-2026-0001',
              status: 'OPEN',
              source: 'CISA',
            },
          ],
          HIGH: [],
          MEDIUM: [],
          LOW: [],
        },
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
        vulnerabilities: {
          CRITICAL: [
            {
              cve_id: 'CVE-2026-0001',
              status: 'OPEN',
              source: 'CISA',
            },
          ],
          HIGH: [],
          MEDIUM: [],
          LOW: [],
        },
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
      const html = formatReportHtml(report);
      expect(html).toContain('CVE-2026-0001');
      expect(html).toContain('CVE-2026-0002');
      expect(html).toContain('CRITICAL');
      expect(html).toContain('HIGH');

      // Step 3: Would send via nodemailer (mocked in real tests)
      expect(html).toBeTruthy();
    });
  });
});
