import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useApi } from '../hooks/useApi';
import { Window, Body, Loading, Notice, Empty, formatDate, relativeTime, SeverityBadge } from '../components/ui';
import type { FleetScanState, Repository, RepositoryPage } from '../types';

const PAGE_SIZES = [25, 50, 100];

/** Clicking a header sorts by it; clicking the active one flips the direction. */
function SortableHeader({
  column,
  label,
  sort,
  order,
  onSort,
}: {
  column: string;
  label: string;
  sort: string;
  order: string;
  onSort: (column: string) => void;
}) {
  const active = sort === column;

  return (
    <th
      onClick={() => onSort(column)}
      style={{ cursor: 'pointer', userSelect: 'none' }}
      title={`Sort by ${label.toLowerCase()}`}
    >
      {label}
      <span className="muted"> {active ? (order === 'desc' ? '↓' : '↑') : '·'}</span>
    </th>
  );
}

const SORTS = [
  { value: 'name', label: 'Name' },
  { value: 'exposure', label: 'Exposure' },
  { value: 'last_scanned_at', label: 'Last scanned' },
  { value: 'primary_language', label: 'Language' },
  { value: 'org_key', label: 'Organization' },
  { value: 'updated_at', label: 'Recently updated' },
];

/** What reaches this repository, and through which dependency. */
export function Repositories({ onAuthLost }: { onAuthLost: () => void }) {
  const [filters, setFilters] = useState({
    search: '',
    org: '',
    language: '',
    status: '',
    exposure: '',
    sort: 'exposure',
    order: 'desc',
    limit: 25,
    offset: 0,
  });

  // Typing rebuilds the query on every keystroke, so the search term is
  // debounced before it becomes a request.
  const [searchInput, setSearchInput] = useState('');
  useEffect(() => {
    const timer = window.setTimeout(
      () => setFilters(prev => (prev.search === searchInput ? prev : { ...prev, search: searchInput, offset: 0 })),
      300
    );
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const path = useMemo(() => {
    const params = new URLSearchParams();
    if (filters.search) params.set('search', filters.search);
    if (filters.org) params.set('org', filters.org);
    if (filters.language) params.set('language', filters.language);
    if (filters.status === 'enabled') params.set('enabled', 'true');
    if (filters.status === 'disabled') params.set('enabled', 'false');
    if (filters.status === 'archived') params.set('archived', 'true');
    if (filters.exposure) params.set('exposure', filters.exposure);
    params.set('sort', filters.sort);
    params.set('order', filters.order);
    params.set('limit', String(filters.limit));
    params.set('offset', String(filters.offset));
    return `/repositories?${params.toString()}`;
  }, [filters]);

  const list = useApi<RepositoryPage>(path, onAuthLost);

  /** Any filter change resets to the first page: page 4 of a new filter is nothing. */
  const set = (patch: Partial<typeof filters>) =>
    setFilters(prev => ({ ...prev, offset: 0, ...patch }));

  /** Same column toggles direction; a new column starts descending. */
  const sortBy = (column: string) =>
    setFilters(prev => ({
      ...prev,
      offset: 0,
      sort: column,
      order: prev.sort === column && prev.order === 'desc' ? 'asc' : 'desc',
    }));
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
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

  return (
    <Window
      title="REPOSITORIES.CFG"
      note={
        list.data
          ? `${list.data.total} shown${list.data.atRisk ? ` · ${list.data.atRisk} exposed` : ''}`
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
        <div className="toolbar">
          <label style={{ flex: 1, minWidth: '12rem' }}>
            Search
            <input
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              placeholder="name or description"
            />
          </label>

          <label style={{ minWidth: '9rem' }}>
            Organization
            <select value={filters.org} onChange={e => set({ org: e.target.value })}>
              <option value="">All</option>
              {list.data?.facets.organizations.map(entry => (
                <option key={entry.value} value={entry.value}>
                  {entry.value} ({entry.count})
                </option>
              ))}
            </select>
          </label>

          <label style={{ minWidth: '9rem' }}>
            Language
            <select value={filters.language} onChange={e => set({ language: e.target.value })}>
              <option value="">All</option>
              {list.data?.facets.languages.map(entry => (
                <option key={entry.value} value={entry.value}>
                  {entry.value} ({entry.count})
                </option>
              ))}
            </select>
          </label>

          <label style={{ minWidth: '8rem' }}>
            Status
            <select value={filters.status} onChange={e => set({ status: e.target.value })}>
              <option value="">All</option>
              <option value="enabled">Enabled</option>
              <option value="disabled">Disabled</option>
              <option value="archived">Archived</option>
            </select>
          </label>

          <label style={{ minWidth: '9rem' }}>
            Exposure
            <select value={filters.exposure} onChange={e => set({ exposure: e.target.value })}>
              <option value="">All</option>
              <option value="affected">Affected</option>
              <option value="exploited">Known exploited</option>
              <option value="clean">Clean</option>
            </select>
          </label>

          <label style={{ minWidth: '9rem' }}>
            Sort by
            <select value={filters.sort} onChange={e => set({ sort: e.target.value })}>
              {SORTS.map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <button
            style={{ alignSelf: 'flex-end' }}
            onClick={() => set({ order: filters.order === 'desc' ? 'asc' : 'desc' })}
            title={filters.order === 'desc' ? 'Descending' : 'Ascending'}
          >
            {filters.order === 'desc' ? '↓' : '↑'}
          </button>

          {filters.search || filters.org || filters.language || filters.status || filters.exposure ? (
            <button
              style={{ alignSelf: 'flex-end' }}
              onClick={() => {
                setSearchInput('');
                set({ search: '', org: '', language: '', status: '', exposure: '' });
              }}
            >
              Clear
            </button>
          ) : null}
        </div>

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

        {scan?.running && scan.progress?.repositories ? (
          <Notice>
            Scanning {scan.progress.repositories.done}/{scan.progress.repositories.total || '…'}{' '}
            repositories
            {(scan.progress.organizations?.total ?? 0) > 1
              ? ` · organization ${(scan.progress.organizations?.done ?? 0) + 1}/${scan.progress.organizations?.total}`
              : ''}
            {scan.progress.repositories.current ? ` · now: ${scan.progress.repositories.current}` : ''}
            {' · '}
            {scan.progress.dependencies ?? 0} dependencies so far
            {scan.progress.errors?.length ? ` · ${scan.progress.errors.length} failed` : ''}
          </Notice>
        ) : null}

        {!scan?.running && scan?.lastRun ? (
          <p className="muted">
            Last scan {relativeTime(scan.lastRun.finishedAt)}: {scan.lastRun.repositories ?? 0} repositories,{' '}
            {scan.lastRun.dependencies ?? 0} dependencies
            {scan.lastRun.errors?.length ? `, ${scan.lastRun.errors.length} failed` : ''}.
          </p>
        ) : null}
        {list.loading ? <Loading what="repositories" /> : null}

        {list.data && list.data.repositories.length === 0 ? (
          <Empty>
            {filters.search || filters.org || filters.language || filters.status || filters.exposure
              ? 'No repository matches these filters.'
              : 'No repositories tracked. Import an organization, or add one to correlate CVEs against the dependencies you actually ship.'}
          </Empty>
        ) : null}

        {list.data && list.data.repositories.length > 0 ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <SortableHeader column="name" label="Name" sort={filters.sort} order={filters.order} onSort={sortBy} />
                  <SortableHeader column="org_key" label="Organization" sort={filters.sort} order={filters.order} onSort={sortBy} />
                  <SortableHeader column="primary_language" label="Language" sort={filters.sort} order={filters.order} onSort={sortBy} />
                  <SortableHeader column="exposure" label="Exposure" sort={filters.sort} order={filters.order} onSort={sortBy} />
                  <SortableHeader column="default_branch" label="Branch" sort={filters.sort} order={filters.order} onSort={sortBy} />
                  <SortableHeader column="last_scanned_at" label="Last scanned" sort={filters.sort} order={filters.order} onSort={sortBy} />
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {list.data.repositories.map(repo => (
                  <tr key={repo.id} style={{ opacity: repo.enabled ? 1 : 0.55 }}>
                      <td>
                        {/* The name opens the repository here; the arrow leaves for GitHub. */}
                        <Link to={`/repositories/${repo.id}`}>{repo.name}</Link>{' '}
                        <a
                          href={repo.url}
                          target="_blank"
                          rel="noreferrer noopener"
                          title="Open on GitHub"
                          className="muted"
                        >
                          ↗
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
                          <Link to={`/repositories/${repo.id}`}>
                            <button>Details</button>
                          </Link>
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
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {list.data && list.data.total > 0 ? (
          <div className="toolbar" style={{ marginTop: '0.6rem' }}>
            <span className="muted mono">
              {list.data.offset + 1}–{list.data.offset + list.data.count} of {list.data.total}
            </span>

            <span className="spacer" style={{ flex: 1 }} />

            <button
              disabled={list.data.offset === 0}
              onClick={() =>
                setFilters(prev => ({ ...prev, offset: Math.max(prev.offset - prev.limit, 0) }))
              }
            >
              ← Previous
            </button>
            <button
              disabled={list.data.offset + list.data.count >= list.data.total}
              onClick={() => setFilters(prev => ({ ...prev, offset: prev.offset + prev.limit }))}
            >
              Next →
            </button>

            <label style={{ minWidth: '7rem' }}>
              Per page
              <select
                value={filters.limit}
                onChange={e => set({ limit: parseInt(e.target.value, 10) })}
              >
                {PAGE_SIZES.map(size => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : null}
      </Body>
    </Window>
  );
}
