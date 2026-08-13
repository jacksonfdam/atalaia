import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { api } from '../api/client';
import {
  Window,
  Body,
  Stat,
  BarRow,
  Loading,
  Notice,
  Empty,
  SeverityBadge,
  StatusBadge,
  SEVERITY_COLOR,
  relativeTime,
} from '../components/ui';
import type {
  Stats,
  VulnerabilityPage,
  ScanState,
  FeedHealthReport,
  Repository,
} from '../types';

const SEVERITY_ORDER = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'];
const STATUS_COLOR: Record<string, string> = {
  OPEN: 'var(--status-open)',
  ACKNOWLEDGED: 'var(--status-acknowledged)',
  RESOLVED: 'var(--status-resolved)',
};

export function Overview({ onAuthLost }: { onAuthLost: () => void }) {
  const stats = useApi<Stats>('/stats', onAuthLost);
  const scan = useApi<ScanState>('/scan', onAuthLost);
  const health = useApi<FeedHealthReport>('/feeds/health', onAuthLost);
  const repos = useApi<{ count: number; atRisk: number; repositories: Repository[] }>(
    '/repositories',
    onAuthLost
  );
  const critical = useApi<VulnerabilityPage>(
    '/vulnerabilities?severity=CRITICAL&status=OPEN&limit=8&sort=cvss_score&order=desc',
    onAuthLost
  );
  // Relevance is fleet-wide, so any page of results carries the same summary.
  const relevance = critical.data?.relevance ?? null;

  const [triggering, setTriggering] = useState(false);
  const [scanMessage, setScanMessage] = useState<string | null>(null);

  async function triggerScan() {
    setTriggering(true);
    setScanMessage(null);
    try {
      await api.post('/scan');
      setScanMessage('Monitoring cycle started. It runs in the background — refresh in a minute.');
      scan.reload();
    } catch (err) {
      setScanMessage((err as Error).message);
    } finally {
      setTriggering(false);
    }
  }

  const severityMax = Math.max(1, ...Object.values(stats.data?.bySeverity ?? {}));
  const statusMax = Math.max(1, ...Object.values(stats.data?.byStatus ?? {}));
  const sourceMax = Math.max(1, ...Object.values(stats.data?.bySource ?? {}));
  const brokenFeeds = (health.data?.feeds ?? []).filter(f => f.status === 'ERROR' || f.status === 'EMPTY');

  return (
    <>
      <Window
        title="OVERVIEW.EXE"
        note={stats.data ? `${stats.data.total} tracked` : undefined}
        accent="var(--accent-primary)"
        actions={
          <button onClick={triggerScan} disabled={triggering || scan.data?.running}>
            {scan.data?.running ? 'Scanning…' : triggering ? 'Starting…' : 'Run scan'}
          </button>
        }
      >
        <Body>
          {stats.loading ? <Loading what="statistics" /> : null}
          {stats.error ? <Notice kind="error">{stats.error}</Notice> : null}

          {stats.data ? (
            <>
              <div className="grid cols-4">
                <Stat label="Tracked" value={stats.data.total} />
                <Stat label="Open" value={stats.data.byStatus.OPEN ?? 0} />
                <Stat label="Critical" value={stats.data.bySeverity.CRITICAL ?? 0} />
                <Stat label="Exploited" value={stats.data.exploited} />
              </div>

              <p className="muted" style={{ marginTop: '0.6rem' }}>
                Last feed activity {relativeTime(stats.data.lastSeenAt)}
                {scan.data?.lastRun
                  ? ` · last triggered scan ${scan.data.lastRun.ok ? 'succeeded' : 'failed'} ${relativeTime(scan.data.lastRun.finishedAt)}`
                  : ''}
              </p>
            </>
          ) : null}

          {scanMessage ? (
            <div style={{ marginTop: '0.6rem' }}>
              <Notice kind="ok">{scanMessage}</Notice>
            </div>
          ) : null}
        </Body>
      </Window>

      {brokenFeeds.length > 0 ? (
        <Window
          title="SOURCE_ALERT.EXE"
          note={`${brokenFeeds.length} degraded`}
          accent="var(--health-error)"
        >
          <Body>
            <Notice kind="error">
              {brokenFeeds.map(f => f.label).join(', ')}{' '}
              {brokenFeeds.length === 1 ? 'is' : 'are'} not returning usable data. Coverage is
              incomplete until fixed — <Link to="/feeds">see source health</Link>.
            </Notice>
          </Body>
        </Window>
      ) : null}

      <div className="grid cols-3">
        <Window title="BY_SEVERITY.DAT" accent="var(--severity-critical)">
          <Body>
            {stats.data ? (
              SEVERITY_ORDER.filter(key => stats.data!.bySeverity[key]).map(key => (
                <BarRow
                  key={key}
                  label={key}
                  count={stats.data!.bySeverity[key]}
                  max={severityMax}
                  color={SEVERITY_COLOR[key]}
                />
              ))
            ) : (
              <Empty>No data</Empty>
            )}
          </Body>
        </Window>

        <Window title="BY_STATUS.DAT" accent="var(--cyan)">
          <Body>
            {stats.data && Object.keys(stats.data.byStatus).length > 0 ? (
              Object.entries(stats.data.byStatus).map(([key, count]) => (
                <BarRow
                  key={key}
                  label={key}
                  count={count}
                  max={statusMax}
                  color={STATUS_COLOR[key] ?? 'var(--win-mid)'}
                />
              ))
            ) : (
              <Empty>No data</Empty>
            )}
          </Body>
        </Window>

        <Window title="BY_SOURCE.DAT" accent="var(--lime)">
          <Body>
            {stats.data && Object.keys(stats.data.bySource).length > 0 ? (
              Object.entries(stats.data.bySource).map(([key, count]) => (
                <BarRow key={key} label={key} count={count} max={sourceMax} color="var(--violet)" />
              ))
            ) : (
              <Empty>No data</Empty>
            )}
          </Body>
        </Window>
      </div>

      <Window
        title="EXPOSED_REPOS.LST"
        note={repos.data ? `${repos.data.atRisk} of ${repos.data.count}` : undefined}
        accent="var(--severity-high)"
      >
        <Body>
          <p className="muted">
            Repositories whose scanned dependencies match an open vulnerability. This is the
            difference between a CVE existing and a CVE being in something you ship.
          </p>

          {repos.loading ? <Loading what="repositories" /> : null}

          {repos.data && repos.data.atRisk === 0 ? (
            <Empty>
              {repos.data.count === 0
                ? 'No repositories tracked yet — import an organization to correlate CVEs against your code.'
                : 'Nothing open reaches the dependencies of any tracked repository.'}
            </Empty>
          ) : null}

          {repos.data && repos.data.atRisk > 0 ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Repository</th>
                    <th>Worst</th>
                    <th>Open CVEs</th>
                    <th>Breakdown</th>
                  </tr>
                </thead>
                <tbody>
                  {repos.data.repositories
                    .filter(repo => (repo.risk?.total ?? 0) > 0)
                    // Worst first: the list is read top-down when deciding what
                    // to fix this afternoon.
                    .sort((a, b) => (b.risk?.total ?? 0) - (a.risk?.total ?? 0))
                    .slice(0, 8)
                    .map(repo => (
                      <tr key={repo.id}>
                        <td>
                          <Link to="/repositories">{repo.name}</Link>
                          {repo.risk?.exploited ? <span title="Known exploited"> 🚨</span> : null}
                        </td>
                        <td className="tight">
                          <SeverityBadge severity={repo.risk?.worst ?? 'UNKNOWN'} />
                        </td>
                        <td className="tight mono">{repo.risk?.total}</td>
                        <td className="tight mono" style={{ fontSize: '0.7rem' }}>
                          {Object.entries(repo.risk?.bySeverity ?? {})
                            .map(([severity, count]) => `${severity}:${count}`)
                            .join('  ')}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </Body>
      </Window>

      <Window
        title="CRITICAL_OPEN.LST"
        note={
          relevance
            ? `${relevance.affecting} of ${relevance.total} collected touch our code`
            : undefined
        }
        accent="var(--severity-critical)"
      >
        <Body flush>
          {critical.loading ? <Loading what="critical vulnerabilities" /> : null}
          {critical.data && critical.data.vulnerabilities.length === 0 ? (
            <Empty>No open critical vulnerabilities. Either genuinely clear, or nothing scanned yet.</Empty>
          ) : null}

          {critical.data && critical.data.vulnerabilities.length > 0 ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>CVE</th>
                    <th>Severity</th>
                    <th>CVSS</th>
                    <th>Status</th>
                    <th>Source</th>
                    <th>Title</th>
                  </tr>
                </thead>
                <tbody>
                  {critical.data.vulnerabilities.map(vuln => (
                    <tr key={vuln.cve_id}>
                      <td className="tight mono">
                        <Link to={`/vulnerabilities/${vuln.cve_id}`}>{vuln.cve_id}</Link>
                      </td>
                      <td className="tight">
                        <SeverityBadge severity={vuln.severity} />
                        {vuln.exploited ? <span className="badge exploited"> EXPLOITED</span> : null}
                      </td>
                      <td className="tight mono">{vuln.cvss_score ?? '—'}</td>
                      <td className="tight">
                        <StatusBadge status={vuln.status} />
                      </td>
                      <td className="tight">{vuln.source}</td>
                      <td>{vuln.title}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </Body>
      </Window>
    </>
  );
}
