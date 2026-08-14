import os from 'node:os';
import { createClient } from '../lib/api.js';

interface Opts {
  json?: boolean;
  actor?: string;
  api?: string;
}

export async function runAck(cveId: string, opts: Opts): Promise<void> {
  try {
    const api = createClient({ baseUrl: opts.api });
    const actor = opts.actor ?? `cli:${os.userInfo().username}`;

    const result = await api.patch<{
      vuln?: { status_changed_at?: string };
      affectedRepositories?: { name: string; url: string }[];
      owners?: { name: string; email: string }[];
      mitigation?: string;
    }>(`/vulnerabilities/${encodeURIComponent(cveId)}/status`, {
      status: 'ACKNOWLEDGED',
      changedBy: actor,
    });

    if (opts.json) {
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      return;
    }

    process.stdout.write(
      `Acknowledged ${cveId} by ${actor} at ${result.vuln?.status_changed_at ?? 'now'}\n`
    );

    if (result.affectedRepositories?.length) {
      process.stdout.write(`\nAffected repositories (${result.affectedRepositories.length}):\n`);
      for (const repo of result.affectedRepositories) {
        process.stdout.write(`  - ${repo.name} (${repo.url})\n`);
      }
    }

    if (result.owners?.length) {
      process.stdout.write('\nResponsible owners:\n');
      for (const owner of result.owners) {
        process.stdout.write(`  - ${owner.name} (${owner.email})\n`);
      }
    }

    if (result.mitigation) {
      process.stdout.write(`\nMitigation guide:\n${result.mitigation}\n`);
    }
  } catch (err) {
    process.stderr.write(`Error: ${(err as Error).message}\n`);
    process.exitCode = 1;
  }
}
