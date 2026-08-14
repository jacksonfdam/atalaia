import os from 'node:os';
import { createClient } from '../lib/api.js';

interface Opts {
  json?: boolean;
  actor?: string;
  api?: string;
}

export async function runResolve(cveId: string, opts: Opts): Promise<void> {
  try {
    const api = createClient({ baseUrl: opts.api });
    const actor = opts.actor ?? `cli:${os.userInfo().username}`;

    const result = await api.patch<{ vuln?: { resolved_at?: string } }>(
      `/vulnerabilities/${encodeURIComponent(cveId)}/status`,
      { status: 'RESOLVED', changedBy: actor }
    );

    if (opts.json) {
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    } else {
      process.stdout.write(
        `Resolved ${cveId} by ${actor} at ${result.vuln?.resolved_at ?? 'now'}\n`
      );
    }
  } catch (err) {
    process.stderr.write(`Error: ${(err as Error).message}\n`);
    process.exitCode = 1;
  }
}
