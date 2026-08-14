import { createClient, type ApiClient } from '../lib/api.js';

/**
 * Repository commands, over the API.
 *
 * They used to import the application layer and open the database, which is not
 * something a terminal on someone's laptop should be doing to a Postgres in the
 * cloud. Every one of these has an endpoint behind it already.
 */

interface BaseOpts {
  json?: boolean;
  api?: string;
}

interface AddOpts extends BaseOpts {
  name?: string;
  provider?: string;
  branch?: string;
  orgKey?: string;
}

interface ListOpts extends BaseOpts {
  deleted?: boolean;
}

interface ScanOpts extends BaseOpts {
  all?: boolean;
  skipVendorLookup?: boolean;
  concurrency?: string;
}

interface DepsOpts extends BaseOpts {
  ecosystem?: string;
}

interface Repo {
  id: number;
  name: string;
  url: string;
  provider: string;
  org_key: string | null;
  default_branch: string | null;
  enabled: boolean;
  deleted_at: string | null;
  last_scanned_at: string | null;
}

interface Dependency {
  ecosystem: string;
  name: string;
  version: string | null;
  opencve_vendor: string | null;
  opencve_product: string | null;
}

function fail(err: unknown): void {
  process.stderr.write(`Error: ${(err as Error).message}\n`);
  process.exitCode = 1;
}

/** The API takes an id or a URL in the same position, so nothing to resolve here. */
function ref(idOrUrl: string): string {
  return encodeURIComponent(idOrUrl);
}

export async function runRepoAdd(url: string, opts: AddOpts): Promise<void> {
  try {
    const api = createClient({ baseUrl: opts.api });
    const repo = await api.post<Repo>('/repositories', {
      url,
      name: opts.name,
      provider: opts.provider,
      orgKey: opts.orgKey,
      defaultBranch: opts.branch || 'main',
    });

    if (opts.json) {
      process.stdout.write(JSON.stringify(repo, null, 2) + '\n');
      return;
    }

    process.stdout.write(`Added repository: ${repo.name} (${repo.url})\n`);
    process.stdout.write(`  Provider: ${repo.provider}\n`);
    process.stdout.write(`  Branch: ${repo.default_branch}\n`);
    process.stdout.write(`  ID: ${repo.id}\n`);
  } catch (err) {
    fail(err);
  }
}

export async function runRepoRemove(idOrUrl: string, opts: BaseOpts): Promise<void> {
  try {
    const api = createClient({ baseUrl: opts.api });
    await api.del(`/repositories/${ref(idOrUrl)}`);
    process.stdout.write(`Repository soft-deleted: ${idOrUrl}\n`);
  } catch (err) {
    fail(err);
  }
}

export async function runRepoList(opts: ListOpts): Promise<void> {
  try {
    const api = createClient({ baseUrl: opts.api });
    const params = new URLSearchParams({ limit: '200' });
    if (opts.deleted) params.set('includeDeleted', 'true');

    const page = await api.get<{ repositories: Repo[]; total: number }>(`/repositories?${params}`);
    const repos = page.repositories ?? [];

    if (opts.json) {
      process.stdout.write(JSON.stringify(repos, null, 2) + '\n');
      return;
    }

    if (repos.length === 0) {
      process.stdout.write('No repositories found.\n');
      return;
    }

    process.stdout.write(
      `${'ID'.padEnd(5)} ${'Name'.padEnd(40)} ${'Provider'.padEnd(10)} ${'Last Scanned'.padEnd(22)} ${'Status'.padEnd(10)}\n`
    );
    process.stdout.write('-'.repeat(90) + '\n');

    for (const r of repos) {
      const status = r.deleted_at ? 'DELETED' : r.enabled ? 'ACTIVE' : 'DISABLED';
      const scanned = r.last_scanned_at ? r.last_scanned_at.slice(0, 19) : 'never';
      process.stdout.write(
        `${String(r.id).padEnd(5)} ${(r.name || '').slice(0, 38).padEnd(40)} ${(r.provider || '').padEnd(10)} ${scanned.padEnd(22)} ${status.padEnd(10)}\n`
      );
    }

    process.stdout.write(`\nTotal: ${page.total ?? repos.length} repositories\n`);
  } catch (err) {
    fail(err);
  }
}

/**
 * Queue a scan — of one repository or of the fleet.
 *
 * It used to run here, which meant the terminal held a scan that takes ten
 * seconds per repository and losing the shell lost the sweep.
 */
export async function runRepoScan(idOrUrl: string | undefined, opts: ScanOpts): Promise<void> {
  try {
    const api = createClient({ baseUrl: opts.api });
    const body = {
      skipVendorLookup: opts.skipVendorLookup === true,
      // Left out when absent so the server's own default applies.
      ...(opts.concurrency ? { concurrency: Number(opts.concurrency) } : {}),
    };

    const path = opts.all || !idOrUrl ? '/repositories/scan-all' : `/repositories/${ref(idOrUrl)}/scan`;
    const result = await api.post<{ accepted: boolean; jobId: string }>(path, body);

    if (opts.json) {
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      return;
    }

    const what = opts.all || !idOrUrl ? 'Fleet scan' : `Scan of ${idOrUrl}`;
    process.stdout.write(`${what} queued (job ${result.jobId}).\n`);
    process.stdout.write('Follow it with: atalaia repo scan-status\n');
  } catch (err) {
    if ((err as { status?: number }).status === 409) {
      process.stderr.write('A scan is already running.\n');
      process.exitCode = 1;
      return;
    }
    fail(err);
  }
}

/** Progress of the fleet sweep, as the console polls it. */
export async function runRepoScanStatus(opts: BaseOpts): Promise<void> {
  try {
    const api = createClient({ baseUrl: opts.api });
    const state = await api.get<{
      running: boolean;
      progress: {
        repositories?: { done: number; total: number; current: string | null; inFlight?: number };
      } | null;
      lastRun: { finishedAt: string; ok: boolean } | null;
    }>('/repositories/scan-all');

    if (opts.json) {
      process.stdout.write(JSON.stringify(state, null, 2) + '\n');
      return;
    }

    if (!state.running) {
      const last = state.lastRun;
      process.stdout.write(
        last
          ? `Idle. Last run ${last.ok ? 'succeeded' : 'failed'} at ${last.finishedAt}\n`
          : 'Idle. No scan has run yet.\n'
      );
      return;
    }

    const repos = state.progress?.repositories;
    process.stdout.write(
      repos
        ? `Running — ${repos.done}/${repos.total} repositories` +
          (repos.inFlight ? `, ${repos.inFlight} in flight` : '') +
          '\n'
        : 'Running…\n'
    );
  } catch (err) {
    fail(err);
  }
}

/** Stop the sweep — or unstick a queue that thinks one is still running. */
export async function runRepoScanCancel(opts: BaseOpts): Promise<void> {
  try {
    const api = createClient({ baseUrl: opts.api });
    const { cancelled } = await api.del<{ cancelled: number }>('/repositories/scan-all');

    process.stdout.write(
      cancelled > 0 ? `Cancelled ${cancelled} queued or running job(s).\n` : 'Nothing was queued.\n'
    );
  } catch (err) {
    fail(err);
  }
}

export async function runRepoDeps(idOrUrl: string, opts: DepsOpts): Promise<void> {
  try {
    const api = createClient({ baseUrl: opts.api });
    const body = await api.get<{ repository: Repo; dependencies: Dependency[] }>(
      `/repositories/${ref(idOrUrl)}/dependencies`
    );

    let deps = body.dependencies ?? [];
    if (opts.ecosystem) {
      deps = deps.filter(d => d.ecosystem?.toUpperCase() === opts.ecosystem!.toUpperCase());
    }

    if (opts.json) {
      process.stdout.write(JSON.stringify(deps, null, 2) + '\n');
      return;
    }

    if (deps.length === 0) {
      process.stdout.write(
        `No dependencies found for ${body.repository?.name ?? idOrUrl}. Run 'atalaia repo scan' first.\n`
      );
      return;
    }

    process.stdout.write(`Dependencies for ${body.repository?.name ?? idOrUrl} (${deps.length} total):\n\n`);
    process.stdout.write(
      `${'Ecosystem'.padEnd(12)} ${'Name'.padEnd(40)} ${'Version'.padEnd(20)} ${'Vendor/Product'.padEnd(30)}\n`
    );
    process.stdout.write('-'.repeat(105) + '\n');

    for (const d of deps) {
      const vp =
        d.opencve_vendor && d.opencve_product ? `${d.opencve_vendor}/${d.opencve_product}` : '—';
      process.stdout.write(
        `${(d.ecosystem || '').padEnd(12)} ${(d.name || '').slice(0, 38).padEnd(40)} ${(d.version || '—').slice(0, 18).padEnd(20)} ${vp.slice(0, 28).padEnd(30)}\n`
      );
    }
  } catch (err) {
    fail(err);
  }
}

/** Turn scanning on or off without losing what has been collected. */
export async function runRepoToggle(idOrUrl: string, enabled: boolean, opts: BaseOpts = {}): Promise<void> {
  try {
    const api = createClient({ baseUrl: opts.api });
    const updated = await api.patch<Repo>(`/repositories/${ref(idOrUrl)}`, { enabled });
    process.stdout.write(`${updated.name} is now ${updated.enabled ? 'enabled' : 'disabled'}\n`);
  } catch (err) {
    fail(err);
  }
}

export async function runRepoRestore(idOrUrl: string, opts: BaseOpts = {}): Promise<void> {
  try {
    const api = createClient({ baseUrl: opts.api });
    const restored = await api.post<Repo>(`/repositories/${ref(idOrUrl)}/restore`);
    process.stdout.write(`Restored ${restored.name}\n`);
  } catch (err) {
    fail(err);
  }
}

export async function runRepoTech(
  idOrUrl: string,
  opts: { refresh?: boolean } & BaseOpts
): Promise<void> {
  try {
    const api = createClient({ baseUrl: opts.api });
    const path = `/repositories/${ref(idOrUrl)}/technologies`;

    const report = opts.refresh
      ? await api.post<TechReport>(path)
      : await api.get<TechReport>(path);

    if (opts.json) {
      process.stdout.write(JSON.stringify(report, null, 2) + '\n');
      return;
    }

    process.stdout.write(`${report.repository.name}\n`);
    process.stdout.write(
      `  Languages:   ${report.languages.map(l => `${l.name} ${l.share ?? 0}%`).join(', ') || 'none recorded'}\n`
    );
    process.stdout.write(`  Topics:      ${report.topics.join(', ') || 'none'}\n`);
    process.stdout.write(
      `  Ecosystems:  ${report.ecosystems.map(e => `${e.name} (${e.packages})`).join(', ') || 'none — run a scan'}\n`
    );
    process.stdout.write(`  Dependencies: ${report.dependencyCount}\n`);
  } catch (err) {
    fail(err);
  }
}

interface TechReport {
  repository: { name: string };
  languages: { name: string; share: number | null }[];
  topics: string[];
  ecosystems: { name: string; packages: number }[];
  dependencyCount: number;
}
