import { useState } from 'react';
import { api } from '../api/client';
import { useApi } from '../hooks/useApi';
import {
  Window,
  Body,
  Loading,
  Notice,
  HealthBadge,
  HEALTH_COLOR,
  relativeTime,
} from '../components/ui';
import type { CatalogPayload, FeedHealth, FeedHealthReport, FeedSource } from '../types';

/**
 * Sources: which databases are collected, and whether collecting them works.
 *
 * A feed can look alive — HTTP 200, plenty of rows — and still be useless for
 * triage, so the count of items that actually carry a CVSS score is shown next
 * to the raw count.
 */
export function Feeds({ onAuthLost }: { onAuthLost: () => void }) {
  const [report, setReport] = useState<FeedHealthReport | null>(null);
  const [probing, setProbing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCatalog, setShowCatalog] = useState(false);

  const sources = useApi<{ feeds: FeedSource[] }>('/feeds', onAuthLost);
  const health = useApi<FeedHealthReport>('/feeds/health', onAuthLost);
  const catalog = useApi<CatalogPayload>(showCatalog ? '/feeds/catalog' : null, onAuthLost);

  const data = report ?? health.data;
  const byName = new Map<string, FeedHealth>((data?.feeds ?? []).map(feed => [feed.name, feed]));

  async function reprobe() {
    setProbing(true);
    setError(null);
    try {
      setReport(await api.get<FeedHealthReport>('/feeds/health?force=true'));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setProbing(false);
    }
  }

  async function toggle(feed: FeedSource) {
    setBusy(feed.name);
    setError(null);
    try {
      await api.patch(`/feeds/${feed.name}`, { enabled: !feed.enabled });
      sources.reload();
      // The health report was computed against the previous state.
      setReport(null);
      health.reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <Window
        title="SOURCE_HEALTH.SYS"
        note={
          data ? `checked ${relativeTime(data.checkedAt)}${data.cached ? ' (cached)' : ''}` : undefined
        }
        accent="var(--accent-tertiary)"
        actions={
          <button onClick={reprobe} disabled={probing}>
            {probing ? 'Probing…' : 'Re-probe'}
          </button>
        }
      >
        <Body>
          {sources.loading && !sources.data ? <Loading what="sources" /> : null}
          {error ? <Notice kind="error">{error}</Notice> : null}
          {health.error ? <Notice kind="error">{health.error}</Notice> : null}
          {probing ? <Notice>Probing every source live. This takes several seconds.</Notice> : null}

          <div className="grid cols-2" style={{ marginTop: '0.6rem' }}>
            {(sources.data?.feeds ?? []).map(source => {
              const probe = byName.get(source.name);
              const status = probe?.status ?? (source.enabled ? 'EMPTY' : 'DISABLED');

              return (
                <div
                  key={source.name}
                  className="stat"
                  style={{
                    borderLeft: `4px solid ${HEALTH_COLOR[status]}`,
                    opacity: source.enabled ? 1 : 0.72,
                  }}
                >
                  <div className="row">
                    <strong style={{ fontSize: '0.85rem' }}>{source.label}</strong>
                    <HealthBadge status={status} />
                    <span className="spacer" />
                    <button disabled={busy === source.name} onClick={() => toggle(source)}>
                      {source.enabled ? 'Disable' : 'Enable'}
                    </button>
                  </div>

                  {source.enabled && probe ? (
                    <div className="row" style={{ marginTop: '0.3rem', gap: '0.9rem' }}>
                      <span className="mono" style={{ fontSize: '0.72rem' }}>
                        {probe.count} items
                      </span>
                      <span
                        className="mono"
                        style={{
                          fontSize: '0.72rem',
                          // A source returning rows with no score is degraded
                          // even though nothing errored.
                          color:
                            probe.count > 0 && probe.withCvss === 0
                              ? 'var(--severity-critical)'
                              : undefined,
                        }}
                      >
                        {probe.withCvss} with CVSS
                      </span>
                      <span className="mono" style={{ fontSize: '0.62rem' }}>
                        {probe.latencyMs}ms
                      </span>
                    </div>
                  ) : null}

                  {source.enabled && probe && probe.count > 0 && probe.withCvss === 0 ? (
                    <p className="muted" style={{ marginTop: '0.3rem' }}>
                      Returns data but no CVSS scores — severity from this source is a guess.
                    </p>
                  ) : null}

                  {probe?.detail ?? source.disabledReason ? (
                    <p className="muted" style={{ marginTop: '0.3rem' }}>
                      {probe?.detail ?? source.disabledReason}
                    </p>
                  ) : null}

                  {source.catalog ? (
                    <p className="muted" style={{ marginTop: '0.3rem' }}>
                      <a href={source.catalog.url} target="_blank" rel="noreferrer noopener">
                        {source.catalog.maintainer}
                      </a>{' '}
                      · {source.catalog.region} · {source.catalog.free ? 'free' : 'paid'}
                    </p>
                  ) : null}

                  {source.overridden ? (
                    <p className="muted mono" style={{ marginTop: '0.3rem', fontSize: '0.62rem' }}>
                      {source.enabled ? 'enabled' : 'disabled'} manually
                      {source.updatedBy ? ` by ${source.updatedBy}` : ''} ·{' '}
                      {relativeTime(source.updatedAt)}
                    </p>
                  ) : null}

                  {probe && Object.keys(probe.severities).length > 0 ? (
                    <p className="muted mono" style={{ marginTop: '0.3rem' }}>
                      {Object.entries(probe.severities)
                        .map(([key, count]) => `${key}:${count}`)
                        .join('  ')}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        </Body>
      </Window>

      <Window
        title="DATABASE_CATALOG.IDX"
        note={catalog.data ? `${catalog.data.implemented} of ${catalog.data.count} collected` : undefined}
        accent="var(--accent-secondary)"
        actions={
          <button onClick={() => setShowCatalog(value => !value)}>
            {showCatalog ? 'Hide' : 'Show'}
          </button>
        }
      >
        {showCatalog ? (
          <Body>
            <p className="muted">
              Public vulnerability databases Atalaia knows about. Those with an adapter appear as a
              source above; the rest are listed so it is clear they exist and why they are not
              collected.
            </p>

            {catalog.loading ? <Loading what="catalog" /> : null}
            {catalog.error ? <Notice kind="error">{catalog.error}</Notice> : null}

            {catalog.data ? (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Database</th>
                      <th>Maintainer</th>
                      <th>Region</th>
                      <th>Access</th>
                      <th>Collected</th>
                    </tr>
                  </thead>
                  <tbody>
                    {catalog.data.databases.map(entry => (
                      <tr key={entry.abbreviation}>
                        <td>
                          <a href={entry.url} target="_blank" rel="noreferrer noopener">
                            {entry.abbreviation}
                          </a>
                          <div className="muted">{entry.description}</div>
                        </td>
                        <td className="tight">{entry.maintainer}</td>
                        <td className="tight">{entry.region}</td>
                        <td className="tight">{entry.free ? 'free' : 'paid'}</td>
                        <td className="tight">
                          {entry.feed ? (
                            <span className="mono">{entry.feed}</span>
                          ) : (
                            <span className="muted">{entry.noAdapterReason ?? 'no adapter yet'}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </Body>
        ) : null}
      </Window>
    </>
  );
}
