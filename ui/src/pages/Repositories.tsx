import { Fragment, useEffect, useState, type FormEvent } from 'react';
import { api } from '../api/client';
import { useApi } from '../hooks/useApi';
import {
  Window,
  Body,
  Loading,
  Notice,
  Empty,
  formatDate,
  relativeTime,
  SeverityBadge,
} from '../components/ui';
import type {
  Dependency,
  FleetScanState,
  Repository,
  RepositoryRiskReport,
  TechnologyReport,
} from '../types';

/** What reaches this repository, and through which dependency. */
function Exposure({ report }: { report: RepositoryRiskReport }) {
  if (report.count === 0) {
    return (
      <p className="muted" style={{ marginBottom: '0.6rem' }}>
        No known vulnerability reaches this repository's dependencies.
      </p>
    );
  }

  return (
    <div className="table-scroll" style={{ marginBottom: '0.6rem' }}>
      <table>
        <thead>
          <tr>
            <th>CVE</th>
            <th>Severity</th>
            <th>Reaches it through</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {report.vulnerabilities.map(vuln => (
            <tr key={vuln.cveId}>
              <td>
                <a href={`/vulnerabilities/${vuln.cveId}`}>{vuln.cveId}</a>
                {vuln.exploited ? <span className="muted"> · exploited</span> : null}
                <div className="muted">{vuln.title}</div>
              </td>
              <td className="tight">
                <SeverityBadge severity={vuln.severity} />
                <span className="muted mono"> {vuln.cvssScore ?? '—'}</span>
              </td>
              <td className="mono" style={{ fontSize: '0.7rem' }}>
                {/* The manifest is the thing to open, so it is named. */}
                {vuln.matches
                  .slice(0, 3)
                  .map(match => `${match.dependency}${match.version ? `@${match.version}` : ''} · ${match.manifestFile ?? '—'}`)
                  .join('  |  ')}
                {vuln.matches.length > 3 ? `  +${vuln.matches.length - 3}` : ''}
              </td>
              <td className="tight">{vuln.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Languages and topics come from the provider; ecosystems come from a scan. */
function Technologies({ report }: { report: TechnologyReport }) {
  return (
    <div className="grid cols-2" style={{ marginBottom: '0.6rem' }}>
      <div className="stat">
        <strong style={{ fontSize: '0.8rem' }}>Languages</strong>
        {report.languages.length === 0 ? (
          <p className="muted">
            None recorded. Import the organization again, or refresh this repository.
          </p>
        ) : (
          <p className="mono" style={{ fontSize: '0.72rem' }}>
            {report.languages.map(lang => `${lang.name} ${lang.share ?? 0}%`).join('  ·  ')}
          </p>
        )}
        {report.topics.length > 0 ? (
          <p className="muted" style={{ marginTop: '0.3rem' }}>topics: {report.topics.join(', ')}</p>
        ) : null}
      </div>

      <div className="stat">
        <strong style={{ fontSize: '0.8rem' }}>Ecosystems</strong>
        {report.ecosystems.length === 0 ? (
          <p className="muted">No manifests parsed yet. Run a scan.</p>
        ) : (
          <p className="mono" style={{ fontSize: '0.72rem' }}>
            {report.ecosystems.map(eco => `${eco.name} (${eco.packages})`).join('  ·  ')}
          </p>
        )}
        <p className="muted" style={{ marginTop: '0.3rem' }}>
          {report.dependencyCount} dependencies · scanned {formatDate(report.lastScannedAt)}
        </p>
      </div>
    </div>
  );
}

export function Repositories({ onAuthLost }: { onAuthLost: () => void }) {
  const list = useApi<{ count: number; atRisk: number; repositories: Repository[] }>(
    '/repositories',
    onAuthLost
  );
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [deps, setDeps] = useState<Record<number, Dependency[]>>({});
  const [techs, setTechs] = useState<Record<number, TechnologyReport>>({});
  const [risks, setRisks] = useState<Record<number, RepositoryRiskReport>>({});
  const [scan, setScan] = useState<FleetScanState | null>(null);

  // The scan runs detached on the server, so its state is polled — while it is
  // running, and once at mount so a reload does not lose sight of it.
  useEffect(() => {
    let active = true;

    async function poll() {
      try {
        const state = await api.get<FleetScanState>('/repositories/scan-all');
        if (!active) return;

        setScan(previous => {
          // A run that just finished leaves new dependencies behind.
          if (previous?.running && !state.running) list.reload();
          return state;
        });
      } catch {
        // Transient; the next tick tries again.
      }
    }

    poll();
    const timer = window.setInterval(poll, scan?.running ? 3000 : 15000);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scan?.running]);

  async function run(action: () => Promise<string>) {
    setBusy(true);
    setMessage(null);
    try {
      setMessage({ kind: 'ok', text: await action() });
      list.reload();
    } catch (err) {
      setMessage({ kind: 'error', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function add(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      const repo = await api.post<Repository>('/repositories', { url });
      setUrl('');
      return `Added ${repo.name}`;
    });
  }

  async function toggleDetails(repo: Repository) {
    if (expanded === repo.id) {
      setExpanded(null);
      return;
    }
    setExpanded(repo.id);

    try {
      if (!deps[repo.id]) {
        const res = await api.get<{ dependencies: Dependency[] }>(
          `/repositories/${repo.id}/dependencies`
        );
        setDeps(prev => ({ ...prev, [repo.id]: res.dependencies }));
      }
      if (!techs[repo.id]) {
        const report = await api.get<TechnologyReport>(`/repositories/${repo.id}/technologies`);
        setTechs(prev => ({ ...prev, [repo.id]: report }));
      }
      if (!risks[repo.id]) {
        const report = await api.get<RepositoryRiskReport>(`/repositories/${repo.id}/vulnerabilities`);
        setRisks(prev => ({ ...prev, [repo.id]: report }));
      }
    } catch (err) {
      setMessage({ kind: 'error', text: (err as Error).message });
    }
  }

  return (
    <Window
      title="REPOSITORIES.CFG"
      note={
        list.data
          ? `${list.data.count} tracked${list.data.atRisk ? ` · ${list.data.atRisk} exposed` : ''}`
          : undefined
      }
      accent="var(--lime)"
      actions={
        <button
          disabled={busy || scan?.running}
          onClick={() =>
            run(async () => {
              await api.post<{ accepted: boolean; startedAt: string }>('/repositories/scan-all');
              setScan(await api.get<FleetScanState>('/repositories/scan-all'));
              return 'Scan started — it runs in the background, one repository at a time.';
            })
          }
        >
          {scan?.running ? 'Scanning…' : 'Scan all'}
        </button>
      }
    >
      <Body>
        <form className="toolbar" onSubmit={add}>
          <label style={{ flex: 1, minWidth: '16rem' }}>
            Repository URL
            <input
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder="https://github.com/org/repo"
              required
            />
          </label>
          <button className="primary" type="submit" disabled={busy || !url}>
            Add
          </button>
        </form>

        {message ? <Notice kind={message.kind}>{message.text}</Notice> : null}
        {list.error ? <Notice kind="error">{list.error}</Notice> : null}

        {scan?.running && scan.progress ? (
          <Notice>
            Scanning {scan.progress.repositories.done}/{scan.progress.repositories.total || '…'}{' '}
            repositories
            {scan.progress.organizations.total > 1
              ? ` · organization ${scan.progress.organizations.done + 1}/${scan.progress.organizations.total}`
              : ''}
            {scan.progress.repositories.current ? ` · now: ${scan.progress.repositories.current}` : ''}
            {' · '}
            {scan.progress.dependencies} dependencies so far
            {scan.progress.errors.length ? ` · ${scan.progress.errors.length} failed` : ''}
          </Notice>
        ) : null}

        {!scan?.running && scan?.lastRun ? (
          <p className="muted">
            Last scan {relativeTime(scan.lastRun.finishedAt)}: {scan.lastRun.repositories} repositories,{' '}
            {scan.lastRun.dependencies} dependencies
            {scan.lastRun.errors.length ? `, ${scan.lastRun.errors.length} failed` : ''}.
          </p>
        ) : null}
        {list.loading ? <Loading what="repositories" /> : null}

        {list.data && list.data.repositories.length === 0 ? (
          <Empty>
            No repositories tracked. Import an organization, or add one to correlate CVEs against
            the dependencies you actually ship.
          </Empty>
        ) : null}

        {list.data && list.data.repositories.length > 0 ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Organization</th>
                  <th>Language</th>
                  <th>Exposure</th>
                  <th>Branch</th>
                  <th>Last scanned</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {list.data.repositories.map(repo => (
                  <Fragment key={repo.id}>
                    <tr style={{ opacity: repo.enabled ? 1 : 0.55 }}>
                      <td>
                        <a href={repo.url} target="_blank" rel="noreferrer noopener">
                          {repo.name}
                        </a>
                        {repo.archived ? <span className="muted"> · archived</span> : null}
                      </td>
                      <td className="tight mono">{repo.org_key ?? '—'}</td>
                      <td className="tight">{repo.primary_language ?? '—'}</td>
                      <td className="tight">
                        {repo.risk && repo.risk.total > 0 ? (
                          <span className="row" style={{ gap: '0.3rem' }}>
                            <SeverityBadge severity={repo.risk.worst ?? 'UNKNOWN'} />
                            <span className="mono">{repo.risk.total}</span>
                            {repo.risk.exploited ? <span title="Known exploited">🚨</span> : null}
                          </span>
                        ) : (
                          <span className="muted">clean</span>
                        )}
                      </td>
                      <td className="tight mono">{repo.default_branch}</td>
                      <td className="tight mono">{formatDate(repo.last_scanned_at)}</td>
                      <td className="tight">
                        <span className="cell-actions">
                          <button onClick={() => toggleDetails(repo)}>
                            {expanded === repo.id ? 'Hide' : 'Details'}
                          </button>
                          <button
                            disabled={busy}
                            onClick={() =>
                              run(async () => {
                                await api.patch(`/repositories/${repo.id}`, {
                                  enabled: !repo.enabled,
                                });
                                return `${repo.name} ${repo.enabled ? 'disabled' : 'enabled'}`;
                              })
                            }
                          >
                            {repo.enabled ? 'Disable' : 'Enable'}
                          </button>
                          <button
                            disabled={busy}
                            onClick={() =>
                              run(async () => {
                                const res = await api.post<{
                                  repoName: string;
                                  dependencyCount: number;
                                }>(`/repositories/${repo.id}/scan`);
                                return `Scanned ${res.repoName}: ${res.dependencyCount} dependencies`;
                              })
                            }
                          >
                            Scan
                          </button>
                          <button
                            className="danger"
                            disabled={busy}
                            onClick={() =>
                              run(async () => {
                                await api.del(`/repositories/${repo.id}`);
                                return `Removed ${repo.name}`;
                              })
                            }
                          >
                            Remove
                          </button>
                        </span>
                      </td>
                    </tr>

                    {expanded === repo.id ? (
                      <tr>
                        <td colSpan={7}>
                          {risks[repo.id] ? <Exposure report={risks[repo.id]} /> : <Loading what="exposure" />}

                          {techs[repo.id] ? (
                            <>
                              <Technologies report={techs[repo.id]} />
                              <button
                                disabled={busy}
                                onClick={() =>
                                  run(async () => {
                                    const report = await api.post<TechnologyReport>(
                                      `/repositories/${repo.id}/technologies`
                                    );
                                    setTechs(prev => ({ ...prev, [repo.id]: report }));
                                    return `Languages refreshed for ${repo.name}`;
                                  })
                                }
                              >
                                Refresh languages
                              </button>
                            </>
                          ) : (
                            <Loading what="technologies" />
                          )}

                          {!deps[repo.id] ? (
                            <Loading what="dependencies" />
                          ) : deps[repo.id].length === 0 ? (
                            <Empty>No dependencies recorded. Run a scan first.</Empty>
                          ) : (
                            <div className="table-scroll" style={{ marginTop: '0.6rem' }}>
                              <table>
                                <thead>
                                  <tr>
                                    <th>Ecosystem</th>
                                    <th>Package</th>
                                    <th>Version</th>
                                    <th>Vendor / product</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {deps[repo.id].map(dep => (
                                    <tr key={dep.id}>
                                      <td className="tight">{dep.ecosystem}</td>
                                      <td className="mono">{dep.name}</td>
                                      <td className="tight mono">{dep.version ?? '—'}</td>
                                      <td className="tight mono">
                                        {dep.opencve_vendor && dep.opencve_product
                                          ? `${dep.opencve_vendor}/${dep.opencve_product}`
                                          : '—'}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Body>
    </Window>
  );
}
