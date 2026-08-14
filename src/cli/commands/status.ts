import { createClient } from '../lib/api.js';
import { fetchStats, summaryStats, countBySeverity } from '../lib/stats.js';

interface Opts {
  json?: boolean;
  api?: string;
}

export async function runStatus(opts: Opts): Promise<void> {
  try {
    const api = createClient({ baseUrl: opts.api });
    const stats = await fetchStats(api);
    const summary = summaryStats(stats);
    const severityOpen = countBySeverity(stats);

    if (opts.json) {
      const openCount = summary.open;
      const bySev: Record<string, number> = {};
      for (const { label, count } of severityOpen) bySev[label.toLowerCase()] = count;
      process.stdout.write(
        JSON.stringify(
          {
            total: summary.total,
            openCount,
            open: summary.open,
            acknowledged: summary.acknowledged,
            resolved: summary.resolved,
            critical: summary.critical,
            exploited: summary.exploited,
            openBySeverity: bySev,
            lastSeenAt: summary.lastSeenAt,
            lastNotifiedAt: summary.lastNotifiedAt,
          },
          null,
          2
        ) + '\n'
      );
      return;
    }

    const ago = (iso: string | null): string => {
      if (!iso) return 'never';
      const secs = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000));
      if (secs < 60) return `${secs}s`;
      if (secs < 3600) return `${Math.floor(secs / 60)}m`;
      if (secs < 86400) return `${Math.floor(secs / 3600)}h`;
      return `${Math.floor(secs / 86400)}d`;
    };

    const sevBits = severityOpen
      .filter((r) => r.count > 0)
      .map((r) => `${r.count} ${r.label}`)
      .join(' · ') || 'none';

    process.stdout.write(
      `${summary.open} OPEN · ${sevBits} · ${summary.exploited} exploited · last scan ${ago(
        summary.lastSeenAt
      )} ago\n`
    );
  } catch (err) {
    process.stderr.write(`Error: ${(err as Error).message}\n`);
    process.exitCode = 1;
  }
}
