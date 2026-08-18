import { useEffect, useMemo, useRef, useState } from 'react';
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
import type { BatchStatusResult, ExplainBatchState, VulnerabilityPage } from '../types';

const PAGE_SIZE = 50;
const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'];
const STATUSES = ['OPEN', 'ACKNOWLEDGED', 'RESOLVED'];

export function Vulnerabilities({ onAuthLost }: { onAuthLost: () => void }) {
  // Filters live in the URL so a filtered view can be linked and survives reload.
  const [params, setParams] = useSearchParams();
  const [busyCve, setBusyCve] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'warn' | 'error'; text: string } | null>(
    null
  );

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

  // Selection for the batch actions. Held as CVE ids rather than row indexes so
  // that a reload after a batch cannot leave the ticks pointing at other rows.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchBusy, setBatchBusy] = useState(false);

  // A different page, or different filters, is a different set of rows: keeping
  // a selection across it would act on things no longer on screen.
  useEffect(() => {
    setSelected(new Set());
  }, [path]);

  const rows = page.data?.vulnerabilities ?? [];
  const selectedOnPage = rows.filter(vuln => selected.has(vuln.cve_id));
  const allOnPageSelected = rows.length > 0 && selectedOnPage.length === rows.length;

  // The header box has three states, and the third one has no attribute: some
  // ticked, but not all, is set on the DOM node by hand.
  const headerBox = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (headerBox.current) {
      headerBox.current.indeterminate = selectedOnPage.length > 0 && !allOnPageSelected;
    }
  }, [selectedOnPage.length, allOnPageSelected]);

  function toggleOne(cveId: string) {
    setSelected(previous => {
      const next = new Set(previous);
      if (next.has(cveId)) next.delete(cveId);
      else next.add(cveId);
      return next;
    });
  }

  function toggleAllOnPage() {
    setSelected(allOnPageSelected ? new Set() : new Set(rows.map(vuln => vuln.cve_id)));
  }

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
      setMessage({ kind: 'ok', text: `${cveId} → ${nextStatus}` });
      page.reload();
    } catch (err) {
      setMessage({ kind: 'error', text: (err as Error).message });
    } finally {
      setBusyCve(null);
    }
  }

  /**
   * A batch reports per CVE, because a selection made from a table will contain
   * rows that cannot make the transition — one already resolved, one someone
   * else acknowledged a second ago. Saying "12 of 15" and naming the three is
   * the difference between a result and a guess.
   */
  async function changeStatusInBatch(nextStatus: 'ACKNOWLEDGED' | 'RESOLVED') {
    setBatchBusy(true);
    setMessage(null);

    try {
      const result = await api.patch<BatchStatusResult>('/vulnerabilities/batch/status', {
        cveIds: [...selected],
        status: nextStatus,
        changedBy: 'console',
      });

      const verb = nextStatus === 'ACKNOWLEDGED' ? 'acknowledged' : 'resolved';
      const parts = [`${result.changed} ${verb}`];

      if (result.skipped > 0) {
        const reasons = result.results.filter(row => !row.ok).slice(0, 3);
        parts.push(
          `${result.skipped} unchanged (${reasons.map(r => `${r.cveId}: ${r.error}`).join('; ')}${
            result.skipped > reasons.length ? '…' : ''
          })`
        );
      }

      if (result.mitigation?.accepted) {
        parts.push(`${result.mitigation.queued} mitigation guides queued`);
      } else if (result.mitigation?.reason) {
        parts.push(`no mitigation guides: ${result.mitigation.reason}`);
      }

      setMessage({ kind: result.skipped > 0 ? 'warn' : 'ok', text: parts.join(' · ') });
      setSelected(new Set());
      page.reload();
      if (result.mitigation?.accepted) pollExplain();
    } catch (err) {
      setMessage({ kind: 'error', text: (err as Error).message });
    } finally {
      setBatchBusy(false);
    }
  }

  // ---------------------------------------------------------------- the job

  const [explain, setExplain] = useState<ExplainBatchState | null>(null);

  // The text runs detached on the server — a model call per CVE — so its state
  // is polled. Once at mount too, so a reload does not lose sight of a batch
  // somebody else started.
  useEffect(() => {
    let active = true;

    async function poll() {
      try {
        const state = await api.get<ExplainBatchState>('/vulnerabilities/batch/explain');
        if (!active) return;

        setExplain(previous => {
          // A finished batch has rewritten explanations the table shows.
          if (previous?.running && !state.running) page.reload();
          return state;
        });
      } catch {
        // Transient; the next tick tries again.
      }
    }

    poll();
    const timer = window.setInterval(poll, explain?.running ? 2000 : 20000);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [explain?.running]);

  /**
   * Stop the batch.
   *
   * Also the way out of "queued, and nothing is happening": a worker killed
   * mid-batch leaves its job active until the expiry window passes, and
   * everything behind it waits.
   */
  async function stopExplaining() {
    setBatchBusy(true);
    try {
      const { cancelled } = await api.del<{ cancelled: number }>('/vulnerabilities/batch/explain');
      setMessage({ kind: 'warn', text: `${cancelled} batch job${cancelled === 1 ? '' : 's'} cancelled` });
      pollExplain();
    } catch (err) {
      setMessage({ kind: 'error', text: (err as Error).message });
    } finally {
      setBatchBusy(false);
    }
  }

  /** Ask once, now, rather than waiting out the idle interval. */
  async function pollExplain() {
    try {
      setExplain(await api.get<ExplainBatchState>('/vulnerabilities/batch/explain'));
    } catch {
      // The interval will catch up.
    }
  }

  async function generateExplanations(force: boolean) {
    setBatchBusy(true);
    setMessage(null);

    try {
      const result = await api.post<{ queued: number }>('/vulnerabilities/batch/explain', {
        cveIds: [...selected],
        force,
      });

      setMessage({
        kind: 'ok',
        text: `${result.queued} queued for explanation${force ? ' (rewriting existing text)' : ''}`,
      });
      setSelected(new Set());
      pollExplain();
    } catch (err) {
      setMessage({ kind: 'error', text: (err as Error).message });
    } finally {
      setBatchBusy(false);
    }
  }

  const progress = explain?.running ? explain.progress : null;
  const waiting = Boolean(explain?.running && !progress);
  const done = progress?.done ?? 0;
  const totalInJob = progress?.total ?? 0;
  const pct = totalInJob > 0 ? Math.round((done / totalInJob) * 100) : 0;

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

        {selected.size > 0 ? (
          <div className="batch-bar">
            <strong>
              {selected.size} selected
              {selectedOnPage.length !== selected.size
                ? ` (${selectedOnPage.length} on this page)`
                : ''}
            </strong>

            <button disabled={batchBusy} onClick={() => changeStatusInBatch('ACKNOWLEDGED')}>
              Acknowledge
            </button>
            <button disabled={batchBusy} onClick={() => changeStatusInBatch('RESOLVED')}>
              Resolve
            </button>
            <button disabled={batchBusy} onClick={() => generateExplanations(false)}>
              Explain the ones without text
            </button>
            <button disabled={batchBusy} onClick={() => generateExplanations(true)}>
              Rewrite all explanations
            </button>

            <span className="spacer" />
            <button disabled={batchBusy} onClick={() => setSelected(new Set())}>
              Clear selection
            </button>
          </div>
        ) : null}

        {progress ? (
          <Notice kind="warn">
            Writing {progress.kind === 'mitigation' ? 'mitigation guides' : 'explanations'} —{' '}
            {done}/{totalInJob} ({pct}%)
            {progress.current ? ` · ${progress.current}` : ''}
            {progress.skipped ? ` · ${progress.skipped} already had text` : ''}
            {progress.failed ? ` · ${progress.failed} failed` : ''}{' '}
            <button disabled={batchBusy} onClick={stopExplaining}>
              Stop
            </button>
            <span className="bar-track">
              <span
                className="bar-fill"
                style={{
                  ['--pct' as string]: `${pct}%`,
                  ['--bar-color' as string]: 'var(--accent-primary)',
                }}
              />
            </span>
          </Notice>
        ) : null}

        {waiting ? (
          <Notice kind="warn">
            A batch is queued and has not started. One runs at a time; if nothing moves, the
            worker running the last one was killed and its job has to time out — or press{' '}
            <button disabled={batchBusy} onClick={stopExplaining}>
              Stop
            </button>{' '}
            to clear it.
          </Notice>
        ) : null}

        {!progress && !waiting && explain?.lastRun && !explain.lastRun.ok ? (
          <Notice kind="error">
            The last batch failed: {explain.lastRun.error ?? 'no reason recorded'}
          </Notice>
        ) : null}

        {message ? <Notice kind={message.kind}>{message.text}</Notice> : null}
        {page.error ? <Notice kind="error">{page.error}</Notice> : null}
        {page.loading ? <Loading what="vulnerabilities" /> : null}

        {page.data && rows.length === 0 && !page.loading ? (
          <Empty>
            Nothing matches these filters.{' '}
            {total === 0 && !severity && !status && !source && !search
              ? 'The database is empty — run a scan from the overview.'
              : null}
          </Empty>
        ) : null}

        {page.data && rows.length > 0 ? (
          <>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th className="pick">
                      <input
                        ref={headerBox}
                        type="checkbox"
                        checked={allOnPageSelected}
                        onChange={toggleAllOnPage}
                        aria-label="Select every row on this page"
                      />
                    </th>
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
                  {rows.map(vuln => (
                    <tr key={vuln.cve_id} data-selected={selected.has(vuln.cve_id) || undefined}>
                      <td className="pick">
                        <input
                          type="checkbox"
                          checked={selected.has(vuln.cve_id)}
                          onChange={() => toggleOne(vuln.cve_id)}
                          aria-label={`Select ${vuln.cve_id}`}
                        />
                      </td>
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
