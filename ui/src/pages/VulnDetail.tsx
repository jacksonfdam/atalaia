import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { api } from '../api/client';
import {
  Window,
  Body,
  Loading,
  Notice,
  Empty,
  SeverityBadge,
  StatusBadge,
  SEVERITY_COLOR,
  formatDate,
} from '../components/ui';
import type { VulnerabilityDetail } from '../types';

export function VulnDetail({ onAuthLost }: { onAuthLost: () => void }) {
  const { cveId } = useParams<{ cveId: string }>();
  const detail = useApi<VulnerabilityDetail>(cveId ? `/vulnerabilities/${cveId}` : null, onAuthLost);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function changeStatus(status: 'ACKNOWLEDGED' | 'RESOLVED') {
    if (!cveId) return;
    setBusy(true);
    setMessage(null);
    try {
      await api.patch(`/vulnerabilities/${cveId}/status`, { status, changedBy: 'console' });
      setMessage(
        status === 'ACKNOWLEDGED'
          ? 'Acknowledged. Atalaia is generating a mitigation guide in the background if an LLM provider is configured.'
          : 'Resolved.'
      );
      detail.reload();
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (detail.loading) return <Loading what={cveId ?? 'vulnerability'} />;
  if (detail.error) return <Notice kind="error">{detail.error}</Notice>;
  if (!detail.data) return <Empty>Not found.</Empty>;

  const { vulnerability: vuln, timeline, affectedRepositories, owners } = detail.data;

  return (
    <>
      <Window
        title={`${vuln.cve_id}.CVE`}
        note={vuln.source}
        accent={SEVERITY_COLOR[vuln.severity] ?? 'var(--pink)'}
        actions={
          <span className="cell-actions">
            <button disabled={busy || vuln.status !== 'OPEN'} onClick={() => changeStatus('ACKNOWLEDGED')}>
              Ack
            </button>
            <button disabled={busy || vuln.status === 'RESOLVED'} onClick={() => changeStatus('RESOLVED')}>
              Resolve
            </button>
          </span>
        }
      >
        <Body>
          <div className="row" style={{ marginBottom: '0.6rem' }}>
            <SeverityBadge severity={vuln.severity} />
            <StatusBadge status={vuln.status} />
            {vuln.exploited ? <span className="badge exploited">Known exploited</span> : null}
            <span className="spacer" />
            <Link to="/vulnerabilities">← Back to list</Link>
          </div>

          <h1 style={{ marginBottom: '0.5rem' }}>{vuln.title ?? vuln.cve_id}</h1>

          {message ? <Notice kind="ok">{message}</Notice> : null}

          <dl className="kv" style={{ marginTop: '0.6rem' }}>
            <dt>CVSS</dt>
            <dd className="mono">{vuln.cvss_score ?? 'Not scored by this source'}</dd>

            <dt>Technologies</dt>
            <dd>{vuln.affectedTechnologies.length ? vuln.affectedTechnologies.join(', ') : '—'}</dd>

            <dt>Source</dt>
            <dd>
              {vuln.source}
              {vuln.source_url ? (
                <>
                  {' · '}
                  <a href={vuln.source_url} target="_blank" rel="noreferrer noopener">
                    advisory ↗
                  </a>
                </>
              ) : null}
            </dd>

            <dt>Changed by</dt>
            <dd>{vuln.status_changed_by ?? '—'}</dd>
          </dl>
        </Body>
      </Window>

      <div className="grid cols-2">
        <Window title="DESCRIPTION.TXT" accent="var(--cyan)">
          <Body cool>
            <p className="prose">{vuln.description || 'No description supplied by the source.'}</p>
          </Body>
        </Window>

        <Window title="EXPLANATION.AI" accent="var(--accent-primary)">
          <Body cool>
            {vuln.client_explanation ? (
              <p className="prose">{vuln.client_explanation}</p>
            ) : (
              <Empty>
                No generated explanation. Set an LLM provider in settings, then acknowledge this CVE.
              </Empty>
            )}
          </Body>
        </Window>
      </div>

      <div className="grid cols-2">
        <Window title="TIMELINE.LOG" accent="var(--lime)">
          <Body>
            {timeline.length === 0 ? (
              <Empty>No events.</Empty>
            ) : (
              <ul className="timeline">
                {timeline.map((event, index) => (
                  <li key={`${event.event}-${index}`}>
                    <time className="mono">{formatDate(event.at)}</time>
                    <span>
                      <strong>{event.event}</strong>
                      {event.detail ? ` — ${event.detail}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Body>
        </Window>

        <Window title="BLAST_RADIUS.MAP" accent="var(--orange)">
          <Body>
            <h3>Affected repositories</h3>
            {affectedRepositories.length === 0 ? (
              <p className="muted">
                None matched. Correlation needs repositories scanned for dependencies.
              </p>
            ) : (
              <ul>
                {affectedRepositories.map(repo => (
                  <li key={repo.id}>{repo.name}</li>
                ))}
              </ul>
            )}

            <h3 style={{ marginTop: '0.7rem' }}>Owners</h3>
            {owners.length === 0 ? (
              <p className="muted">No owner assigned for this technology.</p>
            ) : (
              <ul>
                {owners.map(owner => (
                  <li key={owner.id}>
                    {owner.name} — {owner.email}
                  </li>
                ))}
              </ul>
            )}
          </Body>
        </Window>
      </div>
    </>
  );
}
