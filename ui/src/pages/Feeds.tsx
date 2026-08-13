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
import type { FeedHealthReport } from '../types';

/**
 * Source health. This page exists because a feed can look alive — HTTP 200,
 * plenty of rows — and still be useless for triage. The count of items that
 * actually carry a CVSS score is shown next to the raw count for that reason.
 */
export function Feeds({ onAuthLost }: { onAuthLost: () => void }) {
  const [report, setReport] = useState<FeedHealthReport | null>(null);
  const [probing, setProbing] = useState(false);
  const health = useApi<FeedHealthReport>('/feeds/health', onAuthLost);
  const data = report ?? health.data;

  async function reprobe() {
    setProbing(true);
    try {
      setReport(await api.get<FeedHealthReport>('/feeds/health?force=true'));
    } finally {
      setProbing(false);
    }
  }

  return (
    <Window
      title="SOURCE_HEALTH.SYS"
      note={data ? `checked ${relativeTime(data.checkedAt)}${data.cached ? ' (cached)' : ''}` : undefined}
      accent="var(--accent-tertiary)"
      actions={
        <button onClick={reprobe} disabled={probing}>
          {probing ? 'Probing…' : 'Re-probe'}
        </button>
      }
    >
      <Body>
        {health.loading && !data ? <Loading what="source health" /> : null}
        {health.error ? <Notice kind="error">{health.error}</Notice> : null}
        {probing ? (
          <Notice>Probing every source live. This takes several seconds.</Notice>
        ) : null}

        {data ? (
          <div className="grid cols-2" style={{ marginTop: '0.6rem' }}>
            {data.feeds.map(feed => (
              <div
                key={feed.name}
                className="stat"
                style={{ borderLeft: `4px solid ${HEALTH_COLOR[feed.status]}` }}
              >
                <div className="row">
                  <strong style={{ fontSize: '0.85rem' }}>{feed.label}</strong>
                  <HealthBadge status={feed.status} />
                  <span className="spacer" />
                  <span className="mono" style={{ fontSize: '0.62rem' }}>
                    {feed.latencyMs}ms
                  </span>
                </div>

                <div className="row" style={{ marginTop: '0.3rem', gap: '0.9rem' }}>
                  <span className="mono" style={{ fontSize: '0.72rem' }}>
                    {feed.count} items
                  </span>
                  <span
                    className="mono"
                    style={{
                      fontSize: '0.72rem',
                      // A source returning rows with no score is degraded even
                      // though nothing errored.
                      color: feed.count > 0 && feed.withCvss === 0 ? 'var(--severity-critical)' : undefined,
                    }}
                  >
                    {feed.withCvss} with CVSS
                  </span>
                </div>

                {feed.count > 0 && feed.withCvss === 0 ? (
                  <p className="muted" style={{ marginTop: '0.3rem' }}>
                    Returns data but no CVSS scores — severity from this source is a guess.
                  </p>
                ) : null}

                {feed.detail ? (
                  <p className="muted" style={{ marginTop: '0.3rem' }}>
                    {feed.detail}
                  </p>
                ) : null}

                {Object.keys(feed.severities).length > 0 ? (
                  <p className="muted mono" style={{ marginTop: '0.3rem' }}>
                    {Object.entries(feed.severities)
                      .map(([key, count]) => `${key}:${count}`)
                      .join('  ')}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </Body>
    </Window>
  );
}
