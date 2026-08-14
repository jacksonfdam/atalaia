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
import { runRepoAdd, runRepoRemove, runRepoList, runRepoScan, runRepoScanStatus, runRepoDeps, runRepoToggle, runRepoRestore, runRepoTech } from './commands/repo.js';
import { runOwnerAdd, runOwnerRemove, runOwnerList, runOwnerAssign, runOwnerUnassign, runOwnerShow } from './commands/owner.js';
import { runOrgAdd, runOrgList, runOrgRemove, runOrgUpdate, runOrgImport, runOrgRepos } from './commands/org.js';
import { runFeedList, runFeedToggle, runFeedReset, runFeedCatalog } from './commands/feed.js';

const program = new Command();

program
  .name('atalaia')
  .description('Terminal interface for Atalaia — live dashboard + scriptable commands')
  .version('1.0.0')
  // The CLI is an HTTP client: there is no database path to point at any more,
  // and pointing every terminal at Postgres would mean handing out the
  // connection string.
  .option('--api <url>', 'Atalaia API base URL (default $ATALAIA_API_URL or http://localhost:3000)')
  .hook('preAction', (thisCmd) => {
    const api = thisCmd.opts().api as string | undefined;
    if (api) process.env.ATALAIA_API_URL = api;
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
    'Queue one monitoring cycle. The worker runs it, and it sends Slack notifications for new findings.'
  )
  .option('--json', 'Emit the queued job as JSON')
  .action(async (opts: { json?: boolean }) => {
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
  .command('scan-status')
  .description('Progress of the fleet scan, or how the last one ended')
  .option('--json', 'Emit JSON output')
  .action(async (opts: { json?: boolean }) => {
    await runRepoScanStatus(opts);
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

repo
  .command('enable <id-or-url>')
  .description('Include a repository in scans again')
  .action(async (idOrUrl: string) => {
    await runRepoToggle(idOrUrl, true);
  });

repo
  .command('disable <id-or-url>')
  .description('Leave a repository out of scans, keeping what was collected')
  .action(async (idOrUrl: string) => {
    await runRepoToggle(idOrUrl, false);
  });

repo
  .command('restore <id-or-url>')
  .description('Undo a soft delete')
  .action(async (idOrUrl: string) => {
    await runRepoRestore(idOrUrl);
  });

repo
  .command('tech <id-or-url>')
  .description('Languages and topics from the provider, ecosystems from the manifests')
  .option('--refresh', 'Re-read the language breakdown from the provider')
  .option('--json', 'Emit JSON output')
  .action(async (idOrUrl: string, opts: Record<string, unknown>) => {
    await runRepoTech(idOrUrl, opts as any);
  });

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

const org = program
  .command('org')
  .description('Source-code organizations and their read-only tokens');

org
  .command('add <login>')
  .description('Register a GitHub organization or user')
  .option('--key <key>', 'Stable key used by repositories (default: the login)')
  .option('--name <name>', 'Display name')
  .option('--token <token>', 'Read-only access token, stored encrypted')
  .option('--json', 'Emit JSON output')
  .action(async (login: string, opts: Record<string, unknown>) => {
    await runOrgAdd(login, opts as any);
  });

org
  .command('list')
  .description('List registered organizations')
  .option('--json', 'Emit JSON output')
  .action(async (opts: Record<string, unknown>) => {
    await runOrgList(opts as any);
  });

org
  .command('repos <key>')
  .description('List the repositories the token can see, without importing anything')
  .option('--json', 'Emit JSON output')
  .action(async (key: string, opts: Record<string, unknown>) => {
    await runOrgRepos(key, opts as any);
  });

org
  .command('import [key]')
  .description('Import repositories (read-only). Without a key, every enabled organization.')
  .option('--only <names>', 'Comma-separated repository names or URLs to import')
  .option('--all', 'Import every enabled organization')
  .option('--no-languages', 'Skip the language breakdown — one request less per repository')
  .option('--json', 'Emit JSON output')
  .action(async (key: string | undefined, opts: Record<string, unknown>) => {
    await runOrgImport(key, opts as any);
  });

org
  .command('enable <key>')
  .description('Include an organization in scheduled scans again')
  .action(async (key: string) => {
    await runOrgUpdate(key, { enabled: true });
  });

org
  .command('disable <key>')
  .description('Leave an organization out of scheduled scans')
  .action(async (key: string) => {
    await runOrgUpdate(key, { enabled: false });
  });

org
  .command('token <key> [token]')
  .description('Replace the stored token, or clear it when no token is given')
  .action(async (key: string, token: string | undefined) => {
    await runOrgUpdate(key, { token: token ?? null });
  });

org
  .command('remove <key>')
  .description('Remove an organization and the repositories imported under it')
  .action(async (key: string) => {
    await runOrgRemove(key);
  });

const feed = program
  .command('feed')
  .description('Intelligence sources and the database catalog');

feed
  .command('list')
  .description('List every source and whether it is collected')
  .option('--json', 'Emit JSON output')
  .action(async (opts: Record<string, unknown>) => {
    await runFeedList(opts as any);
  });

feed
  .command('enable <name>')
  .description('Start collecting a source')
  .action(async (name: string) => {
    await runFeedToggle(name, true);
  });

feed
  .command('disable <name>')
  .description('Stop collecting a source')
  .action(async (name: string) => {
    await runFeedToggle(name, false);
  });

feed
  .command('reset <name>')
  .description('Drop the manual override and follow the shipped default')
  .action(async (name: string) => {
    await runFeedReset(name);
  });

feed
  .command('catalog')
  .description('Public vulnerability databases Atalaia knows about')
  .option('--all', 'Include the ones that are not free')
  .option('--json', 'Emit JSON output')
  .action(async (opts: Record<string, unknown>) => {
    await runFeedCatalog(opts as any);
  });

program.parseAsync(process.argv).catch((err) => {
  process.stderr.write(`atalaia: ${err?.message ?? err}\n`);
  process.exit(1);
});
