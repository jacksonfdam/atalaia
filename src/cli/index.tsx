import React from 'react';
import { Command, Option } from 'commander';
import { render } from 'ink';
import { Dashboard } from './dashboard/Dashboard.js';
import { runStatus } from './commands/status.js';
import { runList } from './commands/list.js';
import { runShow } from './commands/show.js';
import { runAck } from './commands/ack.js';
import { runResolve } from './commands/resolve.js';
import { runScan } from './commands/scan.js';

const program = new Command();

program
  .name('atalaia')
  .description('Terminal interface for Atalaia — live dashboard + scriptable commands')
  .version('1.0.0')
  .option('--db <path>', 'Override the SQLite database path (sets $DB_PATH)')
  .hook('preAction', (thisCmd) => {
    const dbPath = thisCmd.opts().db as string | undefined;
    if (dbPath) process.env.DB_PATH = dbPath;
  });

program
  .command('dashboard', { isDefault: true })
  .description('Launch the live Ink dashboard (default)')
  .option('-r, --refresh <seconds>', 'Auto-refresh interval in seconds', '5')
  .action(async (opts: { refresh: string }) => {
    const refreshSeconds = Math.max(1, parseInt(opts.refresh, 10) || 5);
    const { waitUntilExit } = render(<Dashboard refreshSeconds={refreshSeconds} />);
    await waitUntilExit();
  });

program
  .command('status')
  .description('One-shot compact status summary (pipe-friendly)')
  .option('--json', 'Emit JSON instead of plain text')
  .action(async (opts: { json?: boolean }) => {
    await runStatus(opts);
  });

program
  .command('list')
  .description('Query vulnerabilities with optional filters')
  .addOption(new Option('--severity <sev>', 'Filter by severity').choices([
    'CRITICAL',
    'HIGH',
    'MEDIUM',
    'LOW',
    'UNKNOWN',
    'critical',
    'high',
    'medium',
    'low',
    'unknown',
  ]))
  .addOption(new Option('--status <st>', 'Filter by status').choices([
    'OPEN',
    'ACKNOWLEDGED',
    'RESOLVED',
    'open',
    'acknowledged',
    'resolved',
  ]))
  .option('--source <src>', 'Filter by feed source (e.g. nvd, cisa)')
  .option('--tech <tech>', 'Filter by affected technology (case-insensitive substring in JSON)')
  .option('--limit <n>', 'Max rows to return', '50')
  .option('--json', 'Emit JSON instead of a table')
  .action(async (opts: Record<string, unknown>) => {
    await runList({
      severity: opts.severity as string | undefined,
      status: opts.status as string | undefined,
      source: opts.source as string | undefined,
      tech: opts.tech as string | undefined,
      limit: parseInt((opts.limit as string) ?? '50', 10),
      json: opts.json as boolean | undefined,
    });
  });

program
  .command('show <cve-id>')
  .description('Show details for a single CVE, including client explanation and timeline')
  .option('--json', 'Emit JSON instead of formatted text')
  .action(async (cveId: string, opts: { json?: boolean }) => {
    await runShow(cveId, opts);
  });

program
  .command('ack <cve-id>')
  .description('Acknowledge a vulnerability (OPEN → ACKNOWLEDGED)')
  .option('--actor <name>', 'Override actor name (default: cli:<username>)')
  .option('--json', 'Emit JSON of the updated row')
  .action(async (cveId: string, opts: { actor?: string; json?: boolean }) => {
    await runAck(cveId, opts);
  });

program
  .command('resolve <cve-id>')
  .description('Resolve a vulnerability (→ RESOLVED)')
  .option('--actor <name>', 'Override actor name (default: cli:<username>)')
  .option('--json', 'Emit JSON of the updated row')
  .action(async (cveId: string, opts: { actor?: string; json?: boolean }) => {
    await runResolve(cveId, opts);
  });

program
  .command('scan')
  .description(
    'Trigger one monitoring cycle now. WARNING: sends Slack notifications for new findings — use --dry-run to suppress.'
  )
  .option('--dry-run', 'Disarm Slack webhook before running the scan')
  .action(async (opts: { dryRun?: boolean }) => {
    await runScan(opts);
  });

program.parseAsync(process.argv).catch((err) => {
  process.stderr.write(`atalaia: ${err?.message ?? err}\n`);
  process.exit(1);
});
