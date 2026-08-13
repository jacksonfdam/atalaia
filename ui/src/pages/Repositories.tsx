import { Fragment, useState, type FormEvent } from 'react';
import { api } from '../api/client';
import { useApi } from '../hooks/useApi';
import { Window, Body, Loading, Notice, Empty, formatDate } from '../components/ui';
import type { Dependency, Repository } from '../types';

export function Repositories({ onAuthLost }: { onAuthLost: () => void }) {
  const list = useApi<{ count: number; repositories: Repository[] }>('/repositories', onAuthLost);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [deps, setDeps] = useState<Record<number, Dependency[]>>({});

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

  async function toggleDeps(repo: Repository) {
    if (expanded === repo.id) {
      setExpanded(null);
      return;
    }
    setExpanded(repo.id);

    if (!deps[repo.id]) {
      try {
        const res = await api.get<{ dependencies: Dependency[] }>(
          `/repositories/${repo.id}/dependencies`
        );
        setDeps(prev => ({ ...prev, [repo.id]: res.dependencies }));
      } catch (err) {
        setMessage({ kind: 'error', text: (err as Error).message });
      }
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
            No repositories tracked. Add one to correlate CVEs against the dependencies you
            actually ship.
          </Empty>
        ) : null}

        {list.data && list.data.repositories.length > 0 ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Provider</th>
                  <th>Branch</th>
                  <th>Last scanned</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {list.data.repositories.map(repo => (
                  <Fragment key={repo.id}>
                    <tr>
                      <td>
                        <a href={repo.url} target="_blank" rel="noreferrer noopener">
                          {repo.name}
                        </a>
                      </td>
                      <td className="tight">{repo.provider}</td>
                      <td className="tight mono">{repo.default_branch}</td>
                      <td className="tight mono">{formatDate(repo.last_scanned_at)}</td>
                      <td className="tight">
                        <span className="cell-actions">
                          <button onClick={() => toggleDeps(repo)}>
                            {expanded === repo.id ? 'Hide deps' : 'Deps'}
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
                        <td colSpan={5}>
                          {!deps[repo.id] ? (
                            <Loading what="dependencies" />
                          ) : deps[repo.id].length === 0 ? (
                            <Empty>No dependencies recorded. Run a scan first.</Empty>
                          ) : (
                            <div className="table-scroll">
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
