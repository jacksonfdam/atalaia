import type { ApiClient } from './api.js';

/**
 * The shapes the dashboard and the commands render, derived from what the API
 * returns. The counting itself happens in SQL, on the server: the CLI used to
 * do it against a local SQLite file, and there is no local file any more.
 */

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
  exploited: boolean;
  source: string | null;
  source_url: string | null;
  affectedTechnologies: string[];
  status: string | null;
  status_changed_by: string | null;
  status_changed_at: string | null;
  client_explanation: string | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
  notified_at: string | null;
  resolved_at: string | null;
}

/** GET /stats, as the API returns it. */
export interface StatsPayload {
  total: number;
  exploited: number;
  openCritical: number;
  openExploited: number;
  lastSeenAt: string | null;
  lastNotifiedAt: string | null;
  byStatus: Record<string, number>;
  bySeverity: Record<string, number>;
  bySource: Record<string, number>;
  byTechnology: Record<string, number>;
  activity: { date: string; count: number }[];
}

export interface VulnerabilityPage {
  count: number;
  total: number;
  vulnerabilities: VulnRow[];
}

export async function fetchStats(api: ApiClient): Promise<StatsPayload> {
  return api.get<StatsPayload>('/stats');
}

export function summaryStats(stats: StatsPayload): SummaryStats {
  return {
    total: stats.total ?? 0,
    open: stats.byStatus?.OPEN ?? 0,
    acknowledged: stats.byStatus?.ACKNOWLEDGED ?? 0,
    resolved: stats.byStatus?.RESOLVED ?? 0,
    critical: stats.openCritical ?? 0,
    exploited: stats.openExploited ?? 0,
    lastSeenAt: stats.lastSeenAt ?? null,
    lastNotifiedAt: stats.lastNotifiedAt ?? null,
  };
}

const SEVERITY_ORDER = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'];
const STATUS_ORDER = ['OPEN', 'ACKNOWLEDGED', 'RESOLVED'];

/** Every severity, in order, including the ones with nothing in them. */
export function countBySeverity(stats: StatsPayload): CountRow[] {
  return SEVERITY_ORDER.map(label => ({ label, count: stats.bySeverity?.[label] ?? 0 }));
}

export function countByStatus(stats: StatsPayload): CountRow[] {
  return STATUS_ORDER.map(label => ({ label, count: stats.byStatus?.[label] ?? 0 }));
}

export function countBySource(stats: StatsPayload): CountRow[] {
  return Object.entries(stats.bySource ?? {})
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
}

export function topTechnologies(stats: StatsPayload, limit = 8): CountRow[] {
  return Object.entries(stats.byTechnology ?? {})
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

/**
 * The last `days` days, including the empty ones — a sparkline with holes in it
 * reads as missing data rather than as a quiet day.
 */
export function recentActivity(stats: StatsPayload, days = 7): ActivityRow[] {
  const byDate = new Map((stats.activity ?? []).map(row => [row.date, row.count]));
  const out: ActivityRow[] = [];

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    const iso = d.toISOString().slice(0, 10);
    out.push({ date: iso, count: byDate.get(iso) ?? 0 });
  }

  return out;
}

/** Open criticals, newest first. */
export async function latestCritical(api: ApiClient, limit = 5): Promise<VulnRow[]> {
  const page = await api.get<VulnerabilityPage>(
    `/vulnerabilities?status=OPEN&severity=CRITICAL&limit=${limit}&sort=first_seen_at&order=desc`
  );
  return page.vulnerabilities ?? [];
}

export interface ListFilters {
  severity?: string;
  status?: string;
  source?: string;
  tech?: string;
  limit?: number;
}

export async function listVulns(api: ApiClient, filters: ListFilters): Promise<VulnRow[]> {
  const params = new URLSearchParams();

  if (filters.severity) params.set('severity', filters.severity.toUpperCase());
  if (filters.status) params.set('status', filters.status.toUpperCase());
  if (filters.source) params.set('source', filters.source);
  if (filters.tech) params.set('tech', filters.tech);
  params.set('limit', String(filters.limit ?? 50));
  params.set('sort', 'first_seen_at');
  params.set('order', 'desc');

  const page = await api.get<VulnerabilityPage>(`/vulnerabilities?${params}`);
  return page.vulnerabilities ?? [];
}

export async function findVuln(api: ApiClient, cveId: string): Promise<VulnRow | null> {
  try {
    const body = await api.get<{ vuln?: VulnRow } | VulnRow>(
      `/vulnerabilities/${encodeURIComponent(cveId)}`
    );
    // The detail endpoint wraps the row alongside its timeline.
    return ((body as { vuln?: VulnRow }).vuln ?? (body as VulnRow)) || null;
  } catch (err) {
    if ((err as { status?: number }).status === 404) return null;
    throw err;
  }
}
