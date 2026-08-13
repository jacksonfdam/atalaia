import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
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
  formatDate,
} from '../components/ui';
import type { VulnerabilityPage } from '../types';

const PAGE_SIZE = 50;
const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'];
const STATUSES = ['OPEN', 'ACKNOWLEDGED', 'RESOLVED'];

export function Vulnerabilities({ onAuthLost }: { onAuthLost: () => void }) {
  // Filters live in the URL so a filtered view can be linked and survives reload.
  const [params, setParams] = useSearchParams();
  const [busyCve, setBusyCve] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // Defaults to what touches this fleet: the feeds carry tens of thousands of
  // CVEs and a couple of dozen of them are about code anyone here ships.
  const relevance = params.get('relevance') ?? 'affecting';
  const severity = params.get('severity') ?? '';
  const status = params.get('status') ?? '';
  const source = params.get('source') ?? '';
  const search = params.get('search') ?? '';
  const sort = params.get('sort') ?? 'first_seen_at';
  const order = params.get('order') ?? 'desc';
  const offset = parseInt(params.get('offset') ?? '0', 10);

  const path = useMemo(() => {
    const query = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String(offset),
      sort,
      order,
    });
    if (severity) query.set('severity', severity);
    if (status) query.set('status', status);
    if (source) query.set('source', source);
    if (search) query.set('search', search);
    if (relevance !== 'all') query.set('relevance', relevance);
    return `/vulnerabilities?${query}`;
  }, [relevance, severity, status, source, search, sort, order, offset]);

  const page = useApi<VulnerabilityPage>(path, onAuthLost);

  function update(patch: Record<string, string>) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    // Any filter change invalidates the current page position.
    if (!('offset' in patch)) next.delete('offset');
    setParams(next);
  }

  function toggleSort(column: string) {
    update({ sort: column, order: sort === column && order === 'desc' ? 'asc' : 'desc' });
  }

  async function changeStatus(cveId: string, nextStatus: 'ACKNOWLEDGED' | 'RESOLVED') {
    setBusyCve(cveId);
    setMessage(null);
    try {
      await api.patch(`/vulnerabilities/${cveId}/status`, {
        status: nextStatus,
        changedBy: 'console',
      });
      setMessage(`${cveId} → ${nextStatus}`);
      page.reload();
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setBusyCve(null);
    }
  }

  const total = page.data?.total ?? 0;
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + PAGE_SIZE, total);

  return (
    <Window
      title="VULNERABILITIES.DB"
      note={page.data ? `${total} match${total === 1 ? '' : 'es'}` : undefined}
      accent="var(--accent-primary)"
    >
      <Body>
        <div className="toolbar">
          <label>
            Relevance
            <select value={relevance} onChange={e => update({ relevance: e.target.value })}>
              <option value="affecting">
                Affects our code{page.data ? ` (${page.data.relevance.affecting})` : ''}
              </option>
              <option value="infrastructure">
                Containers &amp; CI only{page.data ? ` (${page.data.relevance.infrastructure})` : ''}
              </option>
              <option value="all">
                Everything collected{page.data ? ` (${page.data.relevance.total})` : ''}
              </option>
            </select>
          </label>

          <label>
            Severity
            <select value={severity} onChange={e => update({ severity: e.target.value })}>
              <option value="">All</option>
              {SEVERITIES.map(value => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>

          <label>
            Status
            <select value={status} onChange={e => update({ status: e.target.value })}>
              <option value="">All</option>
              {STATUSES.map(value => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>

          <label>
            Source
            <input
              value={source}
              placeholder="nvd, cisa…"
              onChange={e => update({ source: e.target.value })}
              size={10}
            />
          </label>

          <label>
            Search
            <input
              value={search}
              placeholder="CVE id or title"
              onChange={e => update({ search: e.target.value })}
              size={20}
            />
          </label>

          <span className="spacer" />

          <button onClick={() => setParams(new URLSearchParams())}>Clear</button>
          <button onClick={() => page.reload()}>Refresh</button>
        </div>

        {message ? <Notice kind="ok">{message}</Notice> : null}
        {page.error ? <Notice kind="error">{page.error}</Notice> : null}
        {page.loading ? <Loading what="vulnerabilities" /> : null}

        {page.data && page.data.vulnerabilities.length === 0 && !page.loading ? (
          <Empty>
            Nothing matches these filters.{' '}
            {total === 0 && !severity && !status && !source && !search
              ? 'The database is empty — run a scan from the overview.'
              : null}
          </Empty>
        ) : null}

        {page.data && page.data.vulnerabilities.length > 0 ? (
          <>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th className="sortable" onClick={() => toggleSort('cve_id')}>
                      CVE
                    </th>
                    <th className="sortable" onClick={() => toggleSort('severity')}>
                      Severity
                    </th>
                    <th className="sortable" onClick={() => toggleSort('cvss_score')}>
                      CVSS
                    </th>
                    <th className="sortable" onClick={() => toggleSort('status')}>
                      Status
                    </th>
                    <th className="sortable" onClick={() => toggleSort('source')}>
                      Source
                    </th>
                    <th>Title</th>
                    <th className="sortable" onClick={() => toggleSort('first_seen_at')}>
                      First seen
                    </th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {page.data.vulnerabilities.map(vuln => (
                    <tr key={vuln.cve_id}>
                      <td className="tight mono">
                        <Link to={`/vulnerabilities/${vuln.cve_id}`}>{vuln.cve_id}</Link>
                      </td>
                      <td className="tight">
                        <SeverityBadge severity={vuln.severity} />
                        {vuln.exploited ? <span className="badge exploited"> EXPL</span> : null}
                      </td>
                      <td className="tight mono">{vuln.cvss_score ?? '—'}</td>
                      <td className="tight">
                        <StatusBadge status={vuln.status} />
                      </td>
                      <td className="tight">{vuln.source}</td>
                      <td>{vuln.title}</td>
                      <td className="tight mono">{formatDate(vuln.first_seen_at)}</td>
                      <td className="tight">
                        <span className="cell-actions">
                          <button
                            disabled={busyCve === vuln.cve_id || vuln.status !== 'OPEN'}
                            onClick={() => changeStatus(vuln.cve_id, 'ACKNOWLEDGED')}
                          >
                            Ack
                          </button>
                          <button
                            disabled={busyCve === vuln.cve_id || vuln.status === 'RESOLVED'}
                            onClick={() => changeStatus(vuln.cve_id, 'RESOLVED')}
                          >
                            Resolve
                          </button>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="pagination">
              <button
                disabled={offset === 0}
                onClick={() => update({ offset: String(Math.max(0, offset - PAGE_SIZE)) })}
              >
                ← Prev
              </button>
              <span>
                {from}–{to} of {total}
              </span>
              <button
                disabled={to >= total}
                onClick={() => update({ offset: String(offset + PAGE_SIZE) })}
              >
                Next →
              </button>
            </div>
          </>
        ) : null}
      </Body>
    </Window>
  );
}
