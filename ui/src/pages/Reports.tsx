import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useApi } from '../hooks/useApi';
import { Window, Body, Loading, Notice, Empty, SeverityBadge, formatDate } from '../components/ui';
import type { WeeklyReport, ReportSection } from '../types';

/**
 * The digest, on screen.
 *
 * The same payload the email sends — `GET /reports/weekly` is what both read —
 * so what is here and what lands in an inbox cannot drift apart. That was the
 * complaint that started this: the email listed everything ever collected while
 * the console led with the handful that name something we ship.
 */
export function Reports({ onAuthLost }: { onAuthLost: () => void }) {
  const payload = useApi<{ report: WeeklyReport | null; reason?: string }>(
    '/reports/weekly',
    onAuthLost
  );
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  async function sendNow() {
    setSending(true);
    setMessage(null);

    try {
      const result = await api.post<{ ok: boolean; error?: string; recipients?: string[] }>(
        '/settings/email/test',
        { send: true }
      );

      setMessage(
        result.ok
          ? { kind: 'ok', text: `Sent to ${result.recipients?.join(', ') ?? 'the configured recipients'}` }
          : { kind: 'error', text: result.error ?? 'Could not send' }
      );
    } catch (err) {
      setMessage({ kind: 'error', text: (err as Error).message });
    } finally {
      setSending(false);
    }
  }

  const report = payload.data?.report ?? null;

  return (
    <>
      <Window
        title="REPORT.TXT"
        note={report ? `${report.windowDays} days` : undefined}
        accent="var(--cyan)"
        actions={
          <button disabled={sending || !report} onClick={sendNow}>
            {sending ? 'Sending…' : 'Send now'}
          </button>
        }
      >
        <Body>
          {payload.loading ? <Loading what="the report" /> : null}
          {payload.error ? <Notice kind="error">{payload.error}</Notice> : null}
          {message ? <Notice kind={message.kind}>{message.text}</Notice> : null}

          {payload.data && !report ? <Empty>{payload.data.reason}</Empty> : null}

          {report ? (
            <>
              <p className="muted">
                Detected in the last {report.windowDays} days, as of {formatDate(report.generatedAt)}.
                This is exactly what the weekly email carries.
              </p>

              <div className="grid cols-4">
                <Stat
                  label="Affects our code"
                  value={report.affecting.count}
                  standing={report.affecting.openCount}
                  accent="var(--pink)"
                />
                <Stat
                  label="Containers & CI"
                  value={report.infrastructure.count}
                  standing={report.infrastructure.openCount}
                />
                <Stat label="Everything else" value={report.other.count} />
                <Stat label="Deps behind" value={report.dependencies.count} />
              </div>

              <p className="muted" style={{ marginTop: '0.5rem' }}>
                {report.openTotal} still open in total. The Vulnerabilities page counts{' '}
                <strong>{report.affecting.openCount + (report.infrastructure.openCount ?? 0)}</strong> as
                affecting this fleet — the same findings, with containers and CI folded in rather
                than split out.
              </p>
            </>
          ) : null}
        </Body>
      </Window>

      {report ? (
        <>
          <Window
            title="AFFECTS_OUR_CODE.LST"
            note={`${report.affecting.count}`}
            accent="var(--severity-critical)"
          >
            <Body>
              {report.affecting.repositories.length === 0 ? (
                <Empty>Nothing new reached a tracked repository this period.</Empty>
              ) : (
                report.affecting.repositories.map(repo => (
                  <div key={repo.id} style={{ marginBottom: '1.1rem' }}>
                    <div className="row" style={{ marginBottom: '0.35rem' }}>
                      <strong style={{ fontSize: '0.82rem' }}>
                        <Link to={`/repositories/${repo.id}`}>{repo.name}</Link>
                      </strong>
                      {repo.worstSeverity ? <SeverityBadge severity={repo.worstSeverity} /> : null}
                      <span className="muted">
                        {repo.vulnerabilities.length}{' '}
                        {repo.vulnerabilities.length === 1 ? 'finding' : 'findings'}
                      </span>
                    </div>

                    {repo.vulnerabilities.map(vuln => (
                      <div
                        key={vuln.cveId}
                        style={{
                          padding: '0.45rem 0',
                          borderTop: '1px solid rgba(0,0,0,0.12)',
                        }}
                      >
                        <div className="row">
                          <Link to={`/vulnerabilities/${vuln.cveId}`} className="mono">
                            {vuln.cveId}
                          </Link>
                          <SeverityBadge severity={vuln.severity} />
                          {vuln.cvssScore != null ? (
                            <span className="muted mono">{vuln.cvssScore.toFixed(1)}</span>
                          ) : null}
                          {vuln.exploited ? <span title="Known exploited">🚨</span> : null}
                        </div>

                        {vuln.title ? <div style={{ fontSize: '0.76rem' }}>{vuln.title}</div> : null}

                        {vuln.explanation ? (
                          <p className="muted" style={{ marginTop: '0.2rem' }}>
                            {vuln.explanation}
                          </p>
                        ) : null}

                        <p className="muted" style={{ marginTop: '0.2rem' }}>
                          Arrives through{' '}
                          {vuln.via.map((v, i) => (
                            <span key={`${v.dependency}-${v.manifestFile}-${i}`}>
                              {i > 0 ? ', ' : ''}
                              <span className="mono">{v.dependency}</span>
                              {v.manifestFile ? (
                                <>
                                  {' in '}
                                  <span className="mono">{v.manifestFile}</span>
                                </>
                              ) : null}
                            </span>
                          ))}
                        </p>
                      </div>
                    ))}
                  </div>
                ))
              )}
            </Body>
          </Window>

          <FlatSection
            title="CONTAINERS_AND_CI.LST"
            note="These reach a container image or a CI action, not application code."
            section={report.infrastructure}
            accent="var(--orange)"
          />

          <FlatSection
            title="EVERYTHING_ELSE.LST"
            note="Published somewhere, naming nothing this fleet ships."
            section={report.other}
            accent="var(--win-mid)"
          />

          {report.dependencies.count > 0 ? (
            <Window
              title="DEPS_BEHIND.LST"
              note={`${report.dependencies.count}`}
              accent="var(--lime)"
            >
              <Body>
                <p className="muted" style={{ marginBottom: '0.5rem' }}>
                  The registry has a newer release than the manifest allows. Whether that upgrade is
                  safe is a question about your code.
                </p>

                {report.dependencies.repositories.map(repo => (
                  <div key={repo.id} style={{ marginBottom: '0.7rem' }}>
                    <strong style={{ fontSize: '0.78rem' }}>
                      <Link to={`/repositories/${repo.id}`}>{repo.name}</Link>
                    </strong>
                    <div className="table-scroll">
                      <table>
                        <tbody>
                          {repo.dependencies.slice(0, 10).map(dep => (
                            <tr key={`${dep.ecosystem}-${dep.name}`}>
                              <td className="tight mono">{dep.ecosystem}</td>
                              <td className="mono">{dep.name}</td>
                              <td className="tight mono">{dep.declared ?? '—'}</td>
                              <td className="tight mono">→ {dep.latest}</td>
                              <td className="tight muted">{dep.gap ?? ''}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {repo.dependencies.length > 10 ? (
                      <p className="muted">and {repo.dependencies.length - 10} more</p>
                    ) : null}
                  </div>
                ))}
              </Body>
            </Window>
          ) : null}
        </>
      ) : null}
    </>
  );
}

function Stat({
  label,
  value,
  standing,
  accent,
}: {
  label: string;
  value: number;
  /** Still open, whatever the window — the number the other pages show. */
  standing?: number;
  accent?: string;
}) {
  return (
    <div className="stat">
      <span className="value" style={accent ? { color: accent } : undefined}>
        {value}
      </span>
      <span className="label">
        {label}
        {standing !== undefined ? ` · ${standing} open` : ''}
      </span>
    </div>
  );
}

/** A capped section: the count is the truth, the rows are a sample of it. */
function FlatSection({
  title,
  note,
  section,
  accent,
}: {
  title: string;
  note: string;
  section: ReportSection;
  accent: string;
}) {
  if (section.count === 0) return null;

  return (
    <Window title={title} note={`${section.count}`} accent={accent}>
      <Body>
        <p className="muted" style={{ marginBottom: '0.5rem' }}>
          {note}
        </p>

        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>CVE</th>
                <th>Severity</th>
                <th>CVSS</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {section.vulnerabilities.map(vuln => (
                <tr key={vuln.cveId}>
                  <td className="mono">
                    <Link to={`/vulnerabilities/${vuln.cveId}`}>{vuln.cveId}</Link>
                  </td>
                  <td className="tight">
                    <SeverityBadge severity={vuln.severity} />
                  </td>
                  <td className="tight mono">{vuln.cvssScore?.toFixed(1) ?? '—'}</td>
                  <td className="tight">{vuln.source ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {section.count > section.shown ? (
          <p className="muted" style={{ marginTop: '0.4rem' }}>
            Showing {section.shown} of {section.count}. The Vulnerabilities page lists them all.
          </p>
        ) : null}
      </Body>
    </Window>
  );
}
