import { Fragment, useState, type FormEvent } from 'react';
import { api } from '../api/client';
import { useApi } from '../hooks/useApi';
import { Window, Body, Loading, Notice, Empty, formatDate } from '../components/ui';
import type { Dependency, Repository, TechnologyReport } from '../types';

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
  const list = useApi<{ count: number; repositories: Repository[] }>('/repositories', onAuthLost);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [deps, setDeps] = useState<Record<number, Dependency[]>>({});
  const [techs, setTechs] = useState<Record<number, TechnologyReport>>({});

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
    } catch (err) {
      setMessage({ kind: 'error', text: (err as Error).message });
    }
  }

  return (
    <Window
      title="REPOSITORIES.CFG"
      note={list.data ? `${list.data.count} tracked` : undefined}
      accent="var(--lime)"
      actions={
        <button
          disabled={busy}
          onClick={() =>
            run(async () => {
              const res = await api.post<{ totalRepos: number; totalDeps: number; errors: string[] }>(
                '/repositories/scan-all'
              );
              return `Scanned ${res.totalRepos} repositories, ${res.totalDeps} dependencies${
                res.errors.length ? `, ${res.errors.length} errors` : ''
              }`;
            })
          }
        >
          Scan all
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
                        <td colSpan={6}>
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
