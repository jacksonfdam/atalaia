import os from 'node:os';
import { openWritable } from '../lib/db.js';
import { createCacheFacade } from '../lib/cache.js';
import { acknowledgeVuln } from '#app/application/acknowledgeVuln.js';

interface Opts {
  json?: boolean;
  actor?: string;
}

export async function runAck(cveId: string, opts: Opts): Promise<void> {
  const db = openWritable();
  try {
    const cache = createCacheFacade(db);
    const actor = opts.actor ?? `cli:${os.userInfo().username}`;
    const result = await acknowledgeVuln(cveId, actor, cache);

    if (opts.json) {
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    } else {
      process.stdout.write(
        `Acknowledged ${cveId} by ${actor} at ${result.vuln?.status_changed_at ?? 'now'}\n`
      );

      // Show affected repositories
      if (result.affectedRepositories && result.affectedRepositories.length > 0) {
        process.stdout.write(`\nAffected repositories (${result.affectedRepositories.length}):\n`);
        for (const repo of result.affectedRepositories) {
          process.stdout.write(`  - ${repo.name} (${repo.url})\n`);
        }
      }

      // Show responsible owners
      if (result.owners && result.owners.length > 0) {
        process.stdout.write(`\nResponsible owners:\n`);
        for (const owner of result.owners) {
          process.stdout.write(`  - ${owner.name} (${owner.email})\n`);
        }
      }

      // Show mitigation guide
      if (result.mitigation) {
        process.stdout.write(`\nMitigation guide:\n${result.mitigation}\n`);
      }
    }
  } catch (err) {
    process.stderr.write(`Error: ${(err as Error).message}\n`);
    process.exitCode = 1;
  } finally {
    db.close();
  }
}
