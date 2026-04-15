import type { Database } from 'better-sqlite3';

export interface SummaryStats {
  total: number;
  open: number;
  acknowledged: number;
  resolved: number;
  critical: number;
  exploited: number;
  lastSeenAt: string | null;
  lastNotifiedAt: string | null;
}

export interface CountRow {
  label: string;
  count: number;
}

export interface ActivityRow {
  date: string;
  count: number;
}

export interface VulnRow {
  cve_id: string;
  title: string | null;
  description: string | null;
  severity: string | null;
  cvss_score: number | null;
  exploited: number;
  source: string | null;
  source_url: string | null;
  affected_technologies: string | null;
  status: string | null;
  status_changed_by: string | null;
  status_changed_at: string | null;
  client_explanation: string | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
  notified_at: string | null;
  resolved_at: string | null;
}

export function summaryStats(db: Database): SummaryStats {
  const row = db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN status = 'OPEN' THEN 1 ELSE 0 END) AS open,
         SUM(CASE WHEN status = 'ACKNOWLEDGED' THEN 1 ELSE 0 END) AS acknowledged,
         SUM(CASE WHEN status = 'RESOLVED' THEN 1 ELSE 0 END) AS resolved,
         SUM(CASE WHEN severity = 'CRITICAL' AND status = 'OPEN' THEN 1 ELSE 0 END) AS critical,
         SUM(CASE WHEN exploited = 1 AND status = 'OPEN' THEN 1 ELSE 0 END) AS exploited,
         MAX(last_seen_at) AS last_seen_at,
         MAX(notified_at) AS last_notified_at
       FROM vulnerabilities`
    )
    .get() as Record<string, number | string | null>;

  return {
    total: Number(row.total ?? 0),
    open: Number(row.open ?? 0),
    acknowledged: Number(row.acknowledged ?? 0),
    resolved: Number(row.resolved ?? 0),
    critical: Number(row.critical ?? 0),
    exploited: Number(row.exploited ?? 0),
    lastSeenAt: (row.last_seen_at as string | null) ?? null,
    lastNotifiedAt: (row.last_notified_at as string | null) ?? null,
  };
}

const SEVERITY_ORDER = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'];

export function countBySeverity(db: Database, onlyOpen = false): CountRow[] {
  const where = onlyOpen ? "WHERE status = 'OPEN'" : '';
  const rows = db
    .prepare(
      `SELECT COALESCE(severity, 'UNKNOWN') AS label, COUNT(*) AS count
       FROM vulnerabilities ${where}
       GROUP BY COALESCE(severity, 'UNKNOWN')`
    )
    .all() as CountRow[];
  const byLabel = new Map(rows.map((r) => [r.label, r.count]));
  return SEVERITY_ORDER.map((label) => ({ label, count: byLabel.get(label) ?? 0 }));
}

const STATUS_ORDER = ['OPEN', 'ACKNOWLEDGED', 'RESOLVED'];

export function countByStatus(db: Database): CountRow[] {
  const rows = db
    .prepare(
      `SELECT COALESCE(status, 'OPEN') AS label, COUNT(*) AS count
       FROM vulnerabilities
       GROUP BY COALESCE(status, 'OPEN')`
    )
    .all() as CountRow[];
  const byLabel = new Map(rows.map((r) => [r.label, r.count]));
  return STATUS_ORDER.map((label) => ({ label, count: byLabel.get(label) ?? 0 }));
}

export function countBySource(db: Database): CountRow[] {
  return db
    .prepare(
      `SELECT COALESCE(source, 'unknown') AS label, COUNT(*) AS count
       FROM vulnerabilities
       GROUP BY COALESCE(source, 'unknown')
       ORDER BY count DESC`
    )
    .all() as CountRow[];
}

/**
 * Top N affected technologies across all vulnerabilities.
 * Uses json_each; wrapped in try/catch because a single malformed row
 * would otherwise sink the whole query.
 */
export function topTechnologies(db: Database, limit = 8): CountRow[] {
  try {
    return db
      .prepare(
        `SELECT lower(json_each.value) AS label, COUNT(*) AS count
         FROM vulnerabilities, json_each(vulnerabilities.affected_technologies)
         WHERE affected_technologies IS NOT NULL
           AND affected_technologies != ''
           AND json_valid(affected_technologies) = 1
         GROUP BY lower(json_each.value)
         ORDER BY count DESC
         LIMIT ?`
      )
      .all(limit) as CountRow[];
  } catch {
    return [];
  }
}

export function recentActivity(db: Database, days = 7): ActivityRow[] {
  const rows = db
    .prepare(
      `SELECT date(first_seen_at) AS date, COUNT(*) AS count
       FROM vulnerabilities
       WHERE first_seen_at >= date('now', ?)
       GROUP BY date(first_seen_at)`
    )
    .all(`-${days - 1} days`) as ActivityRow[];

  const byDate = new Map(rows.map((r) => [r.date, r.count]));
  const out: ActivityRow[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    const iso = d.toISOString().slice(0, 10);
    out.push({ date: iso, count: byDate.get(iso) ?? 0 });
  }
  return out;
}

export function latestCritical(db: Database, limit = 5): VulnRow[] {
  return db
    .prepare(
      `SELECT * FROM vulnerabilities
       WHERE status = 'OPEN' AND severity = 'CRITICAL'
       ORDER BY first_seen_at DESC
       LIMIT ?`
    )
    .all(limit) as VulnRow[];
}

export interface ListFilters {
  severity?: string;
  status?: string;
  source?: string;
  tech?: string;
  limit?: number;
}

export function listVulns(db: Database, filters: ListFilters): VulnRow[] {
  const clauses: string[] = [];
  const params: Record<string, unknown> = {};

  if (filters.severity) {
    clauses.push('severity = @severity');
    params.severity = filters.severity.toUpperCase();
  }
  if (filters.status) {
    clauses.push('status = @status');
    params.status = filters.status.toUpperCase();
  }
  if (filters.source) {
    clauses.push('lower(source) = @source');
    params.source = filters.source.toLowerCase();
  }
  if (filters.tech) {
    clauses.push('lower(affected_technologies) LIKE @tech');
    params.tech = `%"${filters.tech.toLowerCase()}"%`;
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = filters.limit ?? 50;

  return db
    .prepare(
      `SELECT * FROM vulnerabilities ${where}
       ORDER BY first_seen_at DESC
       LIMIT ${limit}`
    )
    .all(params) as VulnRow[];
}

export function findVuln(db: Database, cveId: string): VulnRow | null {
  const row = db
    .prepare('SELECT * FROM vulnerabilities WHERE cve_id = ?')
    .get(cveId) as VulnRow | undefined;
  return row ?? null;
}
