import { openReadonly } from '../lib/db.js';
import { findVuln } from '../lib/stats.js';

interface Opts {
  json?: boolean;
}

export async function runShow(cveId: string, opts: Opts): Promise<void> {
  const db = openReadonly();
  try {
    const row = findVuln(db, cveId);
    if (!row) {
      process.stderr.write(`CVE ${cveId} not found.\n`);
      process.exitCode = 1;
      return;
    }

    if (opts.json) {
      process.stdout.write(JSON.stringify(row, null, 2) + '\n');
      return;
    }

    const techs = (() => {
      if (!row.affected_technologies) return [];
      try {
        return JSON.parse(row.affected_technologies) as string[];
      } catch {
        return [];
      }
    })();

    const lines: string[] = [
      `CVE:         ${row.cve_id}`,
      `Title:       ${row.title ?? ''}`,
      `Severity:    ${row.severity ?? 'UNKNOWN'}${
        row.cvss_score != null ? `  (CVSS ${row.cvss_score})` : ''
      }`,
      `Exploited:   ${row.exploited ? 'yes' : 'no'}`,
      `Status:      ${row.status ?? 'OPEN'}${
        row.status_changed_by ? `  by ${row.status_changed_by}` : ''
      }`,
      `Source:      ${row.source ?? ''}${row.source_url ? `  ${row.source_url}` : ''}`,
      `Techs:       ${techs.join(', ') || '—'}`,
      '',
      '— Timeline —',
      `first seen:  ${row.first_seen_at ?? '—'}`,
      `last seen:   ${row.last_seen_at ?? '—'}`,
      `notified:    ${row.notified_at ?? '—'}`,
      `status at:   ${row.status_changed_at ?? '—'}`,
      `resolved at: ${row.resolved_at ?? '—'}`,
    ];

    if (row.description) {
      lines.push('', '— Description —', row.description);
    }
    if (row.client_explanation) {
      lines.push('', '— Client Explanation —', row.client_explanation);
    }

    process.stdout.write(lines.join('\n') + '\n');
  } finally {
    db.close();
  }
}
