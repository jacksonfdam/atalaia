import { useEffect, useState } from 'react';
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
import type {
  Dependency,
  DependencyPage,
  Repository,
  RepositoryRiskReport,
  TechnologyReport,
  VersionCheckState,
} from '../types';

type Tab = 'exposure' | 'dependencies' | 'technologies';

const TABS: { id: Tab; label: string }[] = [
  { id: 'exposure', label: 'Exposure' },
  { id: 'dependencies', label: 'Dependencies' },
  { id: 'technologies', label: 'Technologies' },
];

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
                  const res = await api.post<{ dependencyCount: number }>(
                    `/repositories/${id}/scan`
                  );
                  deps.reload();
                  techs.reload();
                  risk.reload();
                  return `Scanned: ${res.dependencyCount} dependencies`;
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
      {tab === 'dependencies' ? (
        <DependenciesTab repositoryId={String(id)} page={deps.data} loading={deps.loading} reload={deps.reload} />
      ) : null}
      {tab === 'technologies' ? <TechnologiesTab report={techs.data} loading={techs.loading} /> : null}
    </>
  );
}

function ExposureTab({ report, loading }: { report: RepositoryRiskReport | null; loading: boolean }) {
  return (
    <Window
      title="EXPOSURE.LST"
      note={report ? `${report.count} open` : undefined}
      accent="var(--severity-critical)"
    >
      <Body>
        {loading && !report ? <Loading what="exposure" /> : null}

        {report && report.count === 0 ? (
          <Empty>No known vulnerability reaches this repository's dependencies.</Empty>
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
        style={{ color: dependency.outdated ? 'var(--severity-high)' : 'var(--green)' }}
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
