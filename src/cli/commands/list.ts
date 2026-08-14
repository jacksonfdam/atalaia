import { createClient } from '../lib/api.js';
import { listVulns, type ListFilters } from '../lib/stats.js';

interface Opts extends ListFilters {
  json?: boolean;
  api?: string;
}

function truncate(s: string | null, n: number): string {
  const v = s ?? '';
  return v.length > n ? v.slice(0, n - 1) + '…' : v;
}

export async function runList(opts: Opts): Promise<void> {
  try {
    const api = createClient({ baseUrl: opts.api });
    const rows = await listVulns(api, {
      severity: opts.severity,
      status: opts.status,
      source: opts.source,
      tech: opts.tech,
      limit: opts.limit ?? 50,
    });

    if (opts.json) {
      process.stdout.write(JSON.stringify(rows, null, 2) + '\n');
      return;
    }

    if (rows.length === 0) {
      process.stdout.write('No vulnerabilities match.\n');
      return;
    }

    const header =
      'CVE ID'.padEnd(18) +
      'SEV'.padEnd(10) +
      'STATUS'.padEnd(14) +
      'SOURCE'.padEnd(12) +
      'SEEN'.padEnd(12) +
      'TITLE';
    process.stdout.write(header + '\n');
    process.stdout.write('-'.repeat(Math.min(header.length, 120)) + '\n');

    for (const r of rows) {
      const line =
        truncate(r.cve_id, 17).padEnd(18) +
        truncate(r.severity, 9).padEnd(10) +
        truncate(r.status, 13).padEnd(14) +
        truncate(r.source, 11).padEnd(12) +
        (r.first_seen_at ? r.first_seen_at.slice(0, 10) : '----------').padEnd(12) +
        truncate(r.title, 60);
      process.stdout.write(line + '\n');
    }

    if (rows.length === (opts.limit ?? 50)) {
      process.stdout.write(`(showing first ${rows.length}; use --limit to see more)\n`);
    }
  } catch (err) {
    process.stderr.write(`Error: ${(err as Error).message}\n`);
    process.exitCode = 1;
  }
}
