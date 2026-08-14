import { createClient } from '../lib/api.js';
import { findVuln } from '../lib/stats.js';

interface Opts {
  json?: boolean;
  api?: string;
}

export async function runShow(cveId: string, opts: Opts): Promise<void> {
  try {
    const api = createClient({ baseUrl: opts.api });
    const row = await findVuln(api, cveId);
    if (!row) {
      process.stderr.write(`CVE ${cveId} not found.\n`);
      process.exitCode = 1;
      return;
    }

    if (opts.json) {
      process.stdout.write(JSON.stringify(row, null, 2) + '\n');
      return;
    }

    // jsonb on the server, an array over the wire: nothing left to parse.
    const techs = row.affectedTechnologies ?? [];

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
  } catch (err) {
    process.stderr.write(`Error: ${(err as Error).message}\n`);
    process.exitCode = 1;
  }
}
