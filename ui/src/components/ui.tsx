import type { ReactNode } from 'react';

/**
 * The reference design's window chrome, as components.
 *
 * `accent` drives the title bar stripe and the offset shadow. Callers pass a
 * severity or health colour so the chrome carries meaning rather than
 * decoration.
 */
export function Window({
  title,
  note,
  accent = 'var(--pink)',
  actions,
  children,
}: {
  title: string;
  note?: ReactNode;
  accent?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="window" style={{ ['--accent' as string]: accent }}>
      <div className="titlebar">
        <span className="grow">{title}</span>
        {note ? <span className="titlebar-note">{note}</span> : null}
        {actions}
      </div>
      {children}
    </section>
  );
}

export function Body({
  children,
  cool,
  flush,
}: {
  children: ReactNode;
  cool?: boolean;
  flush?: boolean;
}) {
  return (
    <div className={`window-body${cool ? ' cool' : ''}${flush ? ' flush' : ''}`}>{children}</div>
  );
}

export const SEVERITY_COLOR: Record<string, string> = {
  CRITICAL: 'var(--severity-critical)',
  HIGH: 'var(--severity-high)',
  MEDIUM: 'var(--severity-medium)',
  LOW: 'var(--severity-low)',
  UNKNOWN: 'var(--severity-unknown)',
};

export const HEALTH_COLOR: Record<string, string> = {
  OK: 'var(--health-ok)',
  EMPTY: 'var(--health-empty)',
  ERROR: 'var(--health-error)',
  DISABLED: 'var(--health-disabled)',
};

export function SeverityBadge({ severity }: { severity: string }) {
  return (
    <span className="badge" data-severity={severity}>
      {severity}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className="badge" data-status={status}>
      {status}
    </span>
  );
}

export function HealthBadge({ status }: { status: string }) {
  return (
    <span className="badge" data-health={status}>
      {status}
    </span>
  );
}

export function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="stat">
      <span className="value">{value}</span>
      <span className="label">{label}</span>
    </div>
  );
}

/** Horizontal bar chart row. Width comes from the value's share of `max`. */
export function BarRow({
  label,
  count,
  max,
  color,
}: {
  label: string;
  count: number;
  max: number;
  color: string;
}) {
  const pct = max > 0 ? Math.round((count / max) * 100) : 0;
  return (
    <div className="bar-row">
      <span>{label}</span>
      <span className="bar-track">
        <span
          className="bar-fill"
          style={{ ['--pct' as string]: `${pct}%`, ['--bar-color' as string]: color }}
        />
      </span>
      <span className="count">{count}</span>
    </div>
  );
}

export function Loading({ what }: { what: string }) {
  return <div className="loading">Loading {what}…</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Notice({
  kind = 'warn',
  children,
}: {
  kind?: 'warn' | 'error' | 'ok';
  children: ReactNode;
}) {
  const cls = kind === 'warn' ? 'notice' : `notice ${kind}`;
  return <div className={cls}>{children}</div>;
}

/** Timestamps from SQLite are UTC without a zone marker. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const normalised = value.includes('T') ? value : value.replace(' ', 'T') + 'Z';
  const date = new Date(normalised);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString().slice(0, 16).replace('T', ' ');
}

export function relativeTime(value: string | null | undefined): string {
  if (!value) return 'never';
  const normalised = value.includes('T') ? value : value.replace(' ', 'T') + 'Z';
  const then = new Date(normalised).getTime();
  if (Number.isNaN(then)) return value;

  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86400)}d ago`;
}
