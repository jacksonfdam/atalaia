import { createClient } from '../lib/api.js';

interface Opts {
  api?: string;
  json?: boolean;
}

/**
 * Queue a monitoring cycle.
 *
 * It used to run the cycle in this process, which meant the terminal held every
 * feed request and closing it lost the run. The worker owns that now; this asks
 * for it and returns.
 */
export async function runScan(opts: Opts): Promise<void> {
  try {
    const api = createClient({ baseUrl: opts.api });
    const result = await api.post<{ accepted: boolean; jobId: string }>('/scan');

    if (opts.json) {
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      return;
    }

    process.stdout.write(
      `Monitoring cycle queued (job ${result.jobId}). Follow it with: atalaia status\n`
    );
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 409) {
      process.stderr.write('A monitoring cycle is already running.\n');
    } else {
      process.stderr.write(`Error: ${(err as Error).message}\n`);
    }
    process.exitCode = 1;
  }
}
