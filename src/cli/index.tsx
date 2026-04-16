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
import { runRepoAdd, runRepoRemove, runRepoList, runRepoScan, runRepoDeps } from './commands/repo.js';
import { runOwnerAdd, runOwnerRemove, runOwnerList, runOwnerAssign, runOwnerUnassign, runOwnerShow } from './commands/owner.js';

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

// ── repo command group ──

const repo = program
  .command('repo')
  .description('Manage monitored repositories');

repo
  .command('add <url>')
  .description('Add a repository to monitor')
  .option('--name <name>', 'Human-readable name (auto-detected from URL)')
  .option('--provider <type>', 'Provider type: github, gitlab, bitbucket')
  .option('--branch <branch>', 'Default branch', 'main')
  .option('--org-key <key>', 'Config provider key for token resolution')
  .option('--json', 'Emit JSON output')
  .action(async (url: string, opts: Record<string, unknown>) => {
    await runRepoAdd(url, opts as any);
  });

repo
  .command('remove <id-or-url>')
  .description('Soft-delete a repository')
  .option('--json', 'Emit JSON output')
  .action(async (idOrUrl: string, opts: Record<string, unknown>) => {
    await runRepoRemove(idOrUrl, opts as any);
  });

repo
  .command('list')
  .description('List all monitored repositories')
  .option('--deleted', 'Include soft-deleted repositories')
  .option('--json', 'Emit JSON output')
  .action(async (opts: Record<string, unknown>) => {
    await runRepoList(opts as any);
  });

repo
  .command('scan [id-or-url]')
  .description('Scan repository dependencies (or --all for all repos)')
  .option('--all', 'Scan all repositories from all configured providers')
  .option('--skip-vendor-lookup', 'Skip OpenCVE vendor/product resolution (faster)')
  .option('--json', 'Emit JSON output')
  .action(async (idOrUrl: string | undefined, opts: Record<string, unknown>) => {
    await runRepoScan(idOrUrl, opts as any);
  });

repo
  .command('deps <id-or-url>')
  .description('List dependencies for a repository')
  .option('--ecosystem <eco>', 'Filter by ecosystem (e.g. NPM, PIP)')
  .option('--json', 'Emit JSON output')
  .action(async (idOrUrl: string, opts: Record<string, unknown>) => {
    await runRepoDeps(idOrUrl, opts as any);
  });

// ── owner command group ──

const owner = program
  .command('owner')
  .description('Manage system owners (responsible for technologies/repos)');

owner
  .command('add <name>')
  .description('Add a system owner')
  .requiredOption('--email <email>', 'Owner email address')
  .option('--slack <userId>', 'Slack user ID for notifications')
  .option('--json', 'Emit JSON output')
  .action(async (name: string, opts: Record<string, unknown>) => {
    await runOwnerAdd(name, opts as any);
  });

owner
  .command('remove <id>')
  .description('Soft-delete a system owner')
  .option('--json', 'Emit JSON output')
  .action(async (id: string, opts: Record<string, unknown>) => {
    await runOwnerRemove(id, opts as any);
  });

owner
  .command('list')
  .description('List all system owners')
  .option('--json', 'Emit JSON output')
  .action(async (opts: Record<string, unknown>) => {
    await runOwnerList(opts as any);
  });

owner
  .command('assign <ownerId>')
  .description('Assign an owner to a target')
  .addOption(new Option('--type <type>', 'Assignment type').choices(['ecosystem', 'dependency', 'repository']).makeOptionMandatory())
  .requiredOption('--value <value>', 'Target value (e.g. "npm", "express", repo URL)')
  .option('--json', 'Emit JSON output')
  .action(async (ownerId: string, opts: Record<string, unknown>) => {
    await runOwnerAssign(ownerId, opts as any);
  });

owner
  .command('unassign <assignmentId>')
  .description('Remove an owner assignment')
  .action(async (assignmentId: string) => {
    await runOwnerUnassign(assignmentId);
  });

owner
  .command('show <id>')
  .description('Show owner details and assignments')
  .option('--json', 'Emit JSON output')
  .action(async (id: string, opts: Record<string, unknown>) => {
    await runOwnerShow(id, opts as any);
  });

program.parseAsync(process.argv).catch((err) => {
  process.stderr.write(`atalaia: ${err?.message ?? err}\n`);
  process.exit(1);
});
