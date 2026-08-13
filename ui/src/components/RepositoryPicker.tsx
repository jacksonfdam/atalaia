import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { Loading, Notice, Empty } from './ui';
import type { ImportResult, RemoteRepository, RemoteRepositoryList } from '../types';

/**
 * Pick which repositories to import from an organization.
 *
 * An agency organization with 300 repositories rarely wants all 300 scanned, so
 * the list is loaded read-only first and nothing is written until the operator
 * confirms a selection. Repositories already tracked are pre-checked so the
 * dialog also works as "add these two to what I have".
 */
export function RepositoryPicker({
  orgKey,
  onImported,
  onError,
}: {
  orgKey: string;
  onImported: (result: ImportResult) => void;
  onError: (message: string) => void;
}) {
  const [list, setList] = useState<RemoteRepositoryList | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    let active = true;
    setLoading(true);

    api
      .get<RemoteRepositoryList>(`/organizations/${orgKey}/repositories`)
      .then(data => {
        if (!active) return;
        setList(data);
        // Untracked repositories start checked: the common case is a first
        // import, and unchecking a handful beats checking two hundred.
        setSelected(new Set(data.repositories.filter(r => r.state === 'new').map(r => r.name)));
      })
      .catch(err => active && onError((err as Error).message))
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
  }, [orgKey, onError]);

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return list?.repositories ?? [];

    return (list?.repositories ?? []).filter(
      repo =>
        repo.name.toLowerCase().includes(needle) ||
        (repo.primaryLanguage ?? '').toLowerCase().includes(needle) ||
        (repo.description ?? '').toLowerCase().includes(needle) ||
        repo.topics.some(topic => topic.toLowerCase().includes(needle))
    );
  }, [list, filter]);

  function toggle(repo: RemoteRepository) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(repo.name)) next.delete(repo.name);
      else next.add(repo.name);
      return next;
    });
  }

  /** Select/deselect operates on what the filter is showing, not the whole list. */
  function setAllVisible(checked: boolean) {
    setSelected(prev => {
      const next = new Set(prev);
      for (const repo of visible) {
        if (checked) next.add(repo.name);
        else next.delete(repo.name);
      }
      return next;
    });
  }

  async function importSelected() {
    setBusy(true);
    try {
      const result = await api.post<ImportResult>(`/organizations/${orgKey}/import`, {
        repositories: [...selected],
      });
      onImported(result);
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Loading what={`repositories in ${orgKey}`} />;
  if (!list) return null;
  if (list.count === 0) {
    return <Empty>This token cannot see any repository in {list.login}.</Empty>;
  }

  return (
    <div style={{ padding: '0.4rem 0' }}>
      <div className="toolbar">
        <label style={{ flex: 1, minWidth: '14rem' }}>
          Filter
          <input
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="name, language, topic…"
          />
        </label>

        <button onClick={() => setAllVisible(true)}>Select {filter ? 'filtered' : 'all'}</button>
        <button onClick={() => setAllVisible(false)}>Clear</button>

        <button className="primary" disabled={busy || selected.size === 0} onClick={importSelected}>
          {busy ? 'Importing…' : `Import ${selected.size} selected`}
        </button>
      </div>

      <p className="muted">
        {list.count} repositories in {list.login} · {visible.length} shown ·{' '}
        {list.repositories.filter(r => r.state === 'tracked').length} already tracked
      </p>

      {list.access?.visibility === 'public' ? (
        <Notice>
          Only public repositories are visible.{' '}
          {list.access.kind === 'user'
            ? `The token belongs to ${list.access.authenticatedAs ?? 'another account'}, not to ${list.login} — a personal account only exposes its private repositories to its own token.`
            : 'No token is configured for this organization.'}
        </Notice>
      ) : null}

      {visible.length === 0 ? <Notice>Nothing matches that filter.</Notice> : null}

      <div className="table-scroll" style={{ maxHeight: '22rem' }}>
        <table>
          <thead>
            <tr>
              <th style={{ width: '2rem' }} />
              <th>Repository</th>
              <th>Language</th>
              <th>Branch</th>
              <th>State</th>
            </tr>
          </thead>
          <tbody>
            {visible.map(repo => (
              <tr key={repo.url} style={{ opacity: repo.archived ? 0.6 : 1 }}>
                <td className="tight">
                  <input
                    type="checkbox"
                    checked={selected.has(repo.name)}
                    onChange={() => toggle(repo)}
                  />
                </td>
                <td>
                  <a href={repo.url} target="_blank" rel="noreferrer noopener">
                    {repo.name}
                  </a>
                  {repo.archived ? <span className="muted"> · archived</span> : null}
                  {repo.description ? <div className="muted">{repo.description}</div> : null}
                </td>
                <td className="tight">{repo.primaryLanguage ?? '—'}</td>
                <td className="tight mono">{repo.defaultBranch}</td>
                <td className="tight">
                  {repo.state === 'tracked' ? (
                    <span className="muted">tracked{repo.enabled === false ? ', disabled' : ''}</span>
                  ) : repo.state === 'removed' ? (
                    // Selecting one of these is how it comes back: a bulk
                    // import deliberately leaves removed repositories out.
                    <span className="muted">removed here</span>
                  ) : (
                    'new'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
