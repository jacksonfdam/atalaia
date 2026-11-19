import { useEffect, useMemo, useState } from 'react';
import { buildFixPrompt } from '../fixPrompt';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { useApi } from '../hooks/useApi';
import {
  Window,
  Body,
  Loading,
  Notice,
  Empty,
  SeverityBadge,
  formatDate,
  relativeTime,
} from '../components/ui';
import { DependencyReportView } from '../components/DependencyReportView';
import type {
  Dependency,
  DependencyPage,
  Repository,
  RepositoryRiskReport,
  TechnologyReport,
  VersionCheckState,
  DependencyReport,
  Owner,
} from '../types';

type Tab = 'exposure' | 'report' | 'dependencies' | 'technologies';

const TABS: { id: Tab; label: string }[] = [
  { id: 'exposure', label: 'Exposure' },
  { id: 'report', label: 'Report' },
  { id: 'dependencies', label: 'Dependencies' },
  { id: 'technologies', label: 'Technologies' },
];

interface ScanResult {
  repoName: string;
  dependencyCount: number;
}

interface ScanState {
  running: boolean;
  lastRun: { jobId: string; ok: boolean; error: string | null; output: ScanResult | null } | null;
}

const SCAN_POLL_MS = 1500;
const SCAN_GIVE_UP_MS = 10 * 60 * 1000;

/** Queue a scan of one repository and resolve with its result once the worker is done. */
async function scanAndWait(repositoryId: string): Promise<ScanResult> {
  const { jobId } = await api.post<{ accepted: boolean; jobId: string }>(
    `/repositories/${repositoryId}/scan`
  );

  const deadline = Date.now() + SCAN_GIVE_UP_MS;

  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, SCAN_POLL_MS));

    const state = await api.get<ScanState>(`/repositories/${repositoryId}/scan`);
    const last = state.lastRun;

    if (state.running || last?.jobId !== jobId) continue;

    if (!last.ok || !last.output) throw new Error(last.error ?? 'The scan failed');
    return last.output;
  }

  throw new Error('The scan is still running. Reload this page in a minute to see its result.');
}

/**
 * One repository, in full.
 *
 * Each panel loads on its own and shows its own spinner: the dependency list of
 * a large repository is not worth blocking the page for, and a registry check
 * running in the background must never stop anyone from clicking away.
 */
export function RepositoryDetail({ onAuthLost }: { onAuthLost: () => void }) {
  const { id } = useParams();
  const [tab, setTab] = useState<Tab>('exposure');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const repo = useApi<Repository>(`/repositories/${id}`, onAuthLost);
  const risk = useApi<RepositoryRiskReport>(`/repositories/${id}/vulnerabilities`, onAuthLost);
  const techs = useApi<TechnologyReport>(`/repositories/${id}/technologies`, onAuthLost);
  const deps = useApi<DependencyPage>(`/repositories/${id}/dependencies`, onAuthLost);

  // The same endpoint the Reports page reads, scoped to this repository: the
  // summary is defined once and rendered in both places.
  const summary = useApi<{ report: DependencyReport }>(
    `/reports/dependencies?repositoryId=${id}`,
    onAuthLost
  );

  async function run(action: () => Promise<string>) {
    setBusy(true);
    setMessage(null);
    try {
      setMessage({ kind: 'ok', text: await action() });
    } catch (err) {
      setMessage({ kind: 'error', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Window
        title="REPOSITORY.INF"
        note={repo.data?.name}
        accent="var(--lime)"
        actions={
          <>
            <button
              disabled={busy}
              onClick={() =>
                run(async () => {
                  // The scan is a queued job: the POST only says it was accepted.
                  // Reload after it finishes, not before, or the page re-reads the
                  // dependencies the scan has not yet replaced.
                  const result = await scanAndWait(String(id));
                  deps.reload();
                  techs.reload();
                  risk.reload();
                  summary.reload();
                  repo.reload();
                  return `Scanned ${result.repoName}: ${result.dependencyCount} dependencies`;
                })
              }
            >
              Scan now
            </button>
            <Link to="/repositories">
              <button>Back to list</button>
            </Link>
          </>
        }
      >
        <Body>
          {repo.loading ? <Loading what="repository" /> : null}
          {repo.error ? <Notice kind="error">{repo.error}</Notice> : null}
          {message ? <Notice kind={message.kind}>{message.text}</Notice> : null}

          {repo.data ? (
            <>
              <div className="row" style={{ gap: '0.6rem', flexWrap: 'wrap' }}>
                <a href={repo.data.url} target="_blank" rel="noreferrer noopener">
                  {repo.data.url} ↗
                </a>
                {repo.data.archived ? <span className="badge">archived</span> : null}
                {repo.data.enabled ? null : <span className="badge">disabled</span>}
              </div>

              {repo.data.description ? (
                <p className="muted" style={{ marginTop: '0.3rem' }}>
                  {repo.data.description}
                </p>
              ) : null}

              <p className="muted mono" style={{ marginTop: '0.3rem', fontSize: '0.7rem' }}>
                {repo.data.org_key ?? 'no organization'} · {repo.data.primary_language ?? 'no language'} ·
                branch {repo.data.default_branch} · scanned {formatDate(repo.data.last_scanned_at)}
              </p>
            </>
          ) : null}

          <div className="toolbar" style={{ marginTop: '0.6rem' }}>
            {TABS.map(entry => (
              <button
                key={entry.id}
                className={tab === entry.id ? 'primary' : ''}
                onClick={() => setTab(entry.id)}
              >
                {entry.label}
                {entry.id === 'exposure' && risk.data?.count ? ` (${risk.data.count})` : ''}
                {entry.id === 'dependencies' && deps.data?.count ? ` (${deps.data.count})` : ''}
              </button>
            ))}
          </div>
        </Body>
      </Window>

      {tab === 'exposure' ? <ExposureTab report={risk.data} loading={risk.loading} /> : null}
      {tab === 'exposure' && risk.data && risk.data.count > 0 ? <FixPrompt report={risk.data} /> : null}
      {tab === 'report' ? (
        <DependencyReportView
          report={summary.data?.report ?? null}
          loading={summary.loading}
          error={summary.error}
        />
      ) : null}
      {tab === 'dependencies' ? (
        <DependenciesTab repositoryId={String(id)} page={deps.data} loading={deps.loading} reload={deps.reload} />
      ) : null}
      {tab === 'technologies' ? <TechnologiesTab report={techs.data} loading={techs.loading} /> : null}

      {repo.data ? <Subscribers repository={repo.data} onAuthLost={onAuthLost} /> : null}
    </>
  );
}

/**
 * Who hears about this repository.
 *
 * A subscription is an owner assigned to the repository — the same rows Slack
 * already direct-messages, so there is one answer to "who cares about this"
 * rather than two that drift. Subscribing needs to know who you are, and the
 * console has no accounts, so you pick an owner or add one.
 */
function Subscribers({ repository, onAuthLost }: { repository: Repository; onAuthLost: () => void }) {
  const owners = useApi<{ owners: Owner[] }>('/owners', onAuthLost);
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [subscribed, setSubscribed] = useState<Owner[] | null>(null);

  // Who is already assigned to this repository. One request per owner, which is
  // fine for the handful an install has, and it keeps the API surface as it is.
  useEffect(() => {
    let active = true;

    async function load() {
      if (!owners.data) return;

      const found: Owner[] = [];
      for (const owner of owners.data.owners) {
        try {
          const detail = await api.get<{ assignments: { target_type: string; target_value: string }[] }>(
            `/owners/${owner.id}`
          );
          const has = detail.assignments.some(
            a => a.target_type === 'repository' && a.target_value === repository.url
          );
          if (has) found.push(owner);
        } catch {
          // An owner we cannot read is not a reason to hide the rest.
        }
      }

      if (active) setSubscribed(found);
    }

    load();
    return () => {
      active = false;
    };
  }, [owners.data, repository.url]);

  async function subscribe() {
    if (!selected) return;

    setBusy(true);
    setMessage(null);

    try {
      await api.post(`/owners/${selected}/assignments`, {
        targetType: 'repository',
        targetValue: repository.url,
      });

      const owner = owners.data?.owners.find(o => String(o.id) === selected);
      setSubscribed(previous => (owner ? [...(previous ?? []), owner] : previous));
      setSelected('');
      setMessage({
        kind: 'ok',
        text: `${owner?.name ?? 'They'} will hear about new vulnerabilities here, and get a weekly digest of dependencies that fell behind.`,
      });
    } catch (err) {
      setMessage({ kind: 'error', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const available = (owners.data?.owners ?? []).filter(
    owner => !(subscribed ?? []).some(s => s.id === owner.id)
  );

  return (
    <Window title="NOTIFY.CFG" note={subscribed ? `${subscribed.length}` : undefined} accent="var(--violet)">
      <Body>
        <p className="muted">
          A vulnerability that reaches this repository is emailed the moment it is detected.
          Dependencies that fell behind wait for the weekly digest — a freshness check can mark
          dozens at once and none of them is an incident.
        </p>

        {message ? <Notice kind={message.kind}>{message.text}</Notice> : null}
        {owners.loading ? <Loading what="owners" /> : null}

        {subscribed && subscribed.length > 0 ? (
          <div className="table-scroll" style={{ marginTop: '0.5rem' }}>
            <table>
              <tbody>
                {subscribed.map(owner => (
                  <tr key={owner.id}>
                    <td>{owner.name}</td>
                    <td className="mono">{owner.email}</td>
                    <td className="tight muted">{owner.slack_user_id ? 'email + Slack' : 'email'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">Nobody is subscribed to this repository yet.</p>
        )}

        <div className="toolbar" style={{ marginTop: '0.6rem' }}>
          <select value={selected} onChange={e => setSelected(e.target.value)}>
            <option value="">Notify…</option>
            {available.map(owner => (
              <option key={owner.id} value={String(owner.id)}>
                {owner.name} ({owner.email})
              </option>
            ))}
          </select>

          <button className="primary" disabled={busy || !selected} onClick={subscribe}>
            Subscribe
          </button>

          <span className="muted">
            Add someone under Settings → Slack, where owners live.
          </span>
        </div>
      </Body>
    </Window>
  );
}

function ExposureTab({ report, loading }: { report: RepositoryRiskReport | null; loading: boolean }) {
  return (
    <Window
      title="EXPOSURE.LST"
      note={
        report
          ? `${report.count} open${report.unverified > 0 ? ` · ${report.unverified} unverified` : ''}`
          : undefined
      }
      accent="var(--severity-critical)"
    >
      <Body>
        {loading && !report ? <Loading what="exposure" /> : null}

        {report && report.count === 0 ? (
          <Empty>
            No known vulnerability reaches the versions this repository's dependencies declare.
          </Empty>
        ) : null}

        {report && report.unverified > 0 ? (
          <p className="muted" style={{ marginBottom: '0.5rem' }}>
            {report.unverified} of these could not be checked against a version range, so they stay
            listed rather than read as clean. Hover <span className="badge">unverified</span> for the
            reason.
          </p>
        ) : null}

        {report && report.count > 0 ? (
          <div className="table-scroll">
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
                      <Link to={`/vulnerabilities/${vuln.cveId}`}>{vuln.cveId}</Link>
                      {vuln.exploited ? <span title="Known exploited"> 🚨</span> : null}
                      <div className="muted">{vuln.title}</div>
                    </td>
                    <td className="tight">
                      <SeverityBadge severity={vuln.severity} />
                      <span className="muted mono"> {vuln.cvssScore ?? '—'}</span>
                    </td>
                    <td className="mono" style={{ fontSize: '0.7rem' }}>
                      {vuln.matches.map(match => (
                        <div key={`${match.dependency}-${match.manifestFile}`}>
                          {match.dependency}
                          {match.version ? `@${match.version}` : ''} · {match.manifestFile ?? '—'}
                          {match.verdict === 'unverified' ? (
                            <span className="badge" title={match.reason ?? undefined}>
                              unverified
                            </span>
                          ) : null}
                          {match.patchedIn ? <span className="muted"> · fixed in {match.patchedIn}</span> : null}
                        </div>
                      ))}
                    </td>
                    <td className="tight">{vuln.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Body>
    </Window>
  );
}

/**
 * A ready-made brief for a coding agent that fixes what the exposure list shows.
 *
 * Editable on purpose: the operator adds "also bump Node" or "open a PR" before
 * copying. It is rebuilt only when the findings change, never while they type.
 */
function FixPrompt({ report }: { report: RepositoryRiskReport }) {
  const generated = useMemo(() => buildFixPrompt(report), [report]);
  const [text, setText] = useState(generated);
  const [copied, setCopied] = useState<'ok' | 'failed' | null>(null);

  useEffect(() => {
    setText(generated);
    setCopied(null);
  }, [generated]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied('ok');
    } catch {
      // Clipboard access can be refused (insecure origin, no permission); the
      // text is selected so the operator can still copy it by hand.
      document.getElementById('fix-prompt')?.focus();
      (document.getElementById('fix-prompt') as HTMLTextAreaElement | null)?.select();
      setCopied('failed');
    }
  }

  return (
    <Window
      title="FIX.PRM"
      note="prompt for your agent"
      accent="var(--lime)"
      actions={
        <>
          <button disabled={text === generated} onClick={() => setText(generated)}>
            Reset
          </button>
          <button className="primary" onClick={copy}>
            {copied === 'ok' ? 'Copied' : 'Copy'}
          </button>
        </>
      }
    >
      <Body>
        <p className="muted">
          Paste this into Claude Code, Codex or any coding agent, from a checkout of this repository.
          It lists every exposed package and where it is declared, and tells the agent to update to a
          patched, current version.
        </p>
        {copied === 'failed' ? (
          <Notice kind="error">The browser refused clipboard access. The text is selected: copy it with Ctrl/Cmd+C.</Notice>
        ) : null}
        <textarea
          id="fix-prompt"
          className="mono"
          value={text}
          onChange={e => {
            setText(e.target.value);
            setCopied(null);
          }}
          rows={18}
          spellCheck={false}
          style={{ width: '100%', marginTop: '0.5rem', fontSize: '0.75rem' }}
          aria-label="Prompt for a coding agent"
        />
      </Body>
    </Window>
  );
}

const GAP_COLOR: Record<string, string> = {
  major: 'var(--severity-critical)',
  minor: 'var(--severity-high)',
  patch: 'var(--severity-medium)',
};

/** Latest version, and how far behind the manifest is from it. */
function LatestCell({ dependency }: { dependency: Dependency }) {
  if (dependency.versionState === 'unknown' && !dependency.latest_version) {
    return (
      <span className="muted" title={dependency.versionNote ?? dependency.latest_error ?? undefined}>
        {dependency.latest_checked_at ? '—' : 'not checked'}
      </span>
    );
  }

  return (
    <span className="row" style={{ gap: '0.3rem' }}>
      <span
        className="mono"
        style={{ color: dependency.outdated ? 'var(--ink-behind)' : 'var(--ink-ok)' }}
      >
        {dependency.latest_version ?? '—'}
      </span>
      {dependency.versionGap ? (
        <span
          className="badge"
          style={{ background: GAP_COLOR[dependency.versionGap], color: 'var(--win-black)' }}
        >
          {dependency.versionGap}
        </span>
      ) : null}
      {dependency.versionState === 'unknown' ? (
        <span className="muted" title={dependency.versionNote ?? undefined}>
          ?
        </span>
      ) : null}
    </span>
  );
}

function DependenciesTab({
  repositoryId,
  page,
  loading,
  reload,
}: {
  repositoryId: string;
  page: DependencyPage | null;
  loading: boolean;
  reload: () => void;
}) {
  const [check, setCheck] = useState<VersionCheckState | null>(null);
  const [ecosystem, setEcosystem] = useState('');
  const [outdatedOnly, setOutdatedOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // While a check runs, poll it and refresh the rows: each dependency is
  // written as its own lookup returns, so the table fills in progressively.
  useEffect(() => {
    if (!check?.running) return;

    const timer = window.setInterval(async () => {
      try {
        const state = await api.get<VersionCheckState>(`/repositories/${repositoryId}/versions`);
        setCheck(state);
        reload();
      } catch {
        // Transient; the next tick tries again.
      }
    }, 2000);

    return () => window.clearInterval(timer);
  }, [check?.running, repositoryId, reload]);

  async function startCheck(force: boolean) {
    setError(null);
    try {
      await api.post(`/repositories/${repositoryId}/versions`, { force });
      setCheck(await api.get<VersionCheckState>(`/repositories/${repositoryId}/versions`));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const groups = page?.groups ?? [];
  const visibleGroups = ecosystem ? groups.filter(group => group.ecosystem === ecosystem) : groups;

  const rows = (page?.dependencies ?? []).filter(dependency => {
    if (ecosystem && dependency.ecosystem !== ecosystem) return false;
    if (outdatedOnly && !dependency.outdated) return false;
    return true;
  });

  const running = check?.running ?? page?.versionCheck?.running ?? false;
  const progress = check?.progress ?? page?.versionCheck?.progress ?? null;

  return (
    <Window
      title="DEPENDENCIES.LST"
      note={page ? `${page.count} tracked · ${page.outdated} behind` : undefined}
      accent="var(--cyan)"
      actions={
        <>
          <button disabled={running} onClick={() => startCheck(false)}>
            {running ? 'Checking…' : 'Check versions'}
          </button>
          <button disabled={running} onClick={() => startCheck(true)} title="Ignore the cached answers">
            Re-check all
          </button>
        </>
      }
    >
      <Body>
        {loading && !page ? <Loading what="dependencies" /> : null}
        {error ? <Notice kind="error">{error}</Notice> : null}

        {running && progress ? (
          <Notice>
            Looking up {progress.done}/{progress.total} packages
            {progress.current ? ` · now: ${progress.current}` : ''}
            {progress.failed ? ` · ${progress.failed} failed` : ''} — the table fills in as answers
            arrive.
          </Notice>
        ) : null}

        {!running && page && page.unchecked > 0 ? (
          <p className="muted">
            {page.unchecked} of {page.count} have never been checked against their registry.
          </p>
        ) : null}

        {!running && check?.lastRun ? (
          <p className="muted">
            Last check {relativeTime(check.lastRun.finishedAt)}: {check.lastRun.checked} packages
            {check.lastRun.failed ? `, ${check.lastRun.failed} failed` : ''}.
          </p>
        ) : null}

        {page && page.count === 0 ? (
          <Empty>
            {page.repository.last_scanned_at
              ? `Scanned ${formatDate(page.repository.last_scanned_at)} and no manifest file was found — this repository declares no dependencies Atalaia can read.`
              : 'This repository has never been scanned. Use “Scan now” above.'}
          </Empty>
        ) : null}

        {page && page.count > 0 ? (
          <>
            <div className="toolbar">
              <label style={{ minWidth: '10rem' }}>
                Ecosystem
                <select value={ecosystem} onChange={e => setEcosystem(e.target.value)}>
                  <option value="">All ({page.count})</option>
                  {groups.map(group => (
                    <option key={group.ecosystem} value={group.ecosystem}>
                      {group.ecosystem} ({group.count})
                    </option>
                  ))}
                </select>
              </label>

              <label className="row" style={{ gap: '0.3rem', alignSelf: 'flex-end' }}>
                <input
                  type="checkbox"
                  checked={outdatedOnly}
                  onChange={e => setOutdatedOnly(e.target.checked)}
                />
                Behind only
              </label>

              <span className="spacer" style={{ flex: 1 }} />
              <span className="muted mono">{rows.length} shown</span>
            </div>

            {/* One table per ecosystem: an Android repository carries Gradle,
                GitHub Actions, Fastlane gems and npm at once, and nobody reads
                those interleaved. */}
            {visibleGroups.map(group => {
              const groupRows = rows.filter(dependency => dependency.ecosystem === group.ecosystem);
              if (groupRows.length === 0) return null;

              return (
                <div key={group.ecosystem} style={{ marginTop: '0.8rem' }}>
                  <div className="row" style={{ gap: '0.5rem' }}>
                    <strong style={{ fontSize: '0.82rem' }}>{group.ecosystem}</strong>
                    <span className="muted mono" style={{ fontSize: '0.7rem' }}>
                      {groupRows.length} shown · {group.outdated} behind
                      {group.unchecked ? ` · ${group.unchecked} unchecked` : ''}
                    </span>
                  </div>

                  <div className="table-scroll" style={{ maxHeight: '24rem' }}>
                    <table>
                      <thead>
                        <tr>
                          <th>Package</th>
                          <th>Current</th>
                          <th>Latest</th>
                          <th>Manifest</th>
                        </tr>
                      </thead>
                      <tbody>
                        {groupRows.map(dependency => (
                          <tr key={dependency.id}>
                            <td className="mono">{dependency.name}</td>
                            <td className="tight mono">{dependency.version ?? '—'}</td>
                            <td className="tight mono">
                              <LatestCell dependency={dependency} />
                            </td>
                            <td className="tight mono" style={{ fontSize: '0.68rem' }}>
                              {dependency.manifest_file ?? '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </>
        ) : null}
      </Body>
    </Window>
  );
}

function TechnologiesTab({ report, loading }: { report: TechnologyReport | null; loading: boolean }) {
  return (
    <Window title="TECHNOLOGIES.DAT" accent="var(--violet)">
      <Body>
        {loading && !report ? <Loading what="technologies" /> : null}

        {report ? (
          <div className="grid cols-2">
            <div className="stat">
              <strong style={{ fontSize: '0.8rem' }}>Languages</strong>
              {report.languages.length === 0 ? (
                <p className="muted">None recorded.</p>
              ) : (
                report.languages.map(language => (
                  <p key={language.name} className="mono" style={{ fontSize: '0.72rem' }}>
                    {language.name} — {language.share ?? 0}%
                  </p>
                ))
              )}
              {report.topics.length > 0 ? (
                <p className="muted" style={{ marginTop: '0.3rem' }}>topics: {report.topics.join(', ')}</p>
              ) : null}
            </div>

            <div className="stat">
              <strong style={{ fontSize: '0.8rem' }}>Ecosystems</strong>
              {report.ecosystems.length === 0 ? (
                <p className="muted">No manifests parsed yet.</p>
              ) : (
                report.ecosystems.map(entry => (
                  <p key={entry.name} className="mono" style={{ fontSize: '0.72rem' }}>
                    {entry.name} — {entry.packages} packages
                  </p>
                ))
              )}
            </div>
          </div>
        ) : null}
      </Body>
    </Window>
  );
}
