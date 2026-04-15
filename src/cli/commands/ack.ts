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
    const updated = await acknowledgeVuln(cveId, actor, cache);
    if (opts.json) {
      process.stdout.write(JSON.stringify(updated, null, 2) + '\n');
    } else {
      process.stdout.write(
        `Acknowledged ${cveId} by ${actor} at ${updated.status_changed_at}\n`
      );
    }
  } catch (err) {
    process.stderr.write(`Error: ${(err as Error).message}\n`);
    process.exitCode = 1;
  } finally {
    db.close();
  }
}
