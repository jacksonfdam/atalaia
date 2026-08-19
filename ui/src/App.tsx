import { useCallback, useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { auth, type SessionInfo } from './api/client';
import { useApi } from './hooks/useApi';
import { useDesktopAlerts } from './hooks/useDesktopAlerts';
import { Login } from './pages/Login';
import { Overview } from './pages/Overview';
import { Vulnerabilities } from './pages/Vulnerabilities';
import { Reports } from './pages/Reports';
import { VulnDetail } from './pages/VulnDetail';
import { Feeds } from './pages/Feeds';
import { Repositories } from './pages/Repositories';
import { RepositoryDetail } from './pages/RepositoryDetail';
import { Settings } from './pages/Settings';
import type { FeedHealthReport, Stats } from './types';

const NAV = [
  { to: '/', label: 'Overview', end: true },
  { to: '/vulnerabilities', label: 'Vulnerabilities' },
  { to: '/reports', label: 'Reports' },
  { to: '/feeds', label: 'Sources' },
  { to: '/repositories', label: 'Repositories' },
  { to: '/settings', label: 'Settings' },
];

function Shell({ onAuthLost, session }: { onAuthLost: () => void; session: SessionInfo }) {
  const stats = useApi<Stats>('/stats', onAuthLost);
  const health = useApi<FeedHealthReport>('/feeds/health', onAuthLost);

  // Runs wherever the operator is in the console, not only on the
  // notifications page.
  useDesktopAlerts();

  const degraded = (health.data?.feeds ?? []).filter(
    feed => feed.status === 'ERROR' || feed.status === 'EMPTY' || feed.status === 'NOT_CONFIGURED'
  ).length;

  const tallies: Record<string, number | undefined> = {
    '/vulnerabilities': stats.data?.byStatus.OPEN,
    '/feeds': degraded || undefined,
  };

  return (
    <div className="shell">
      <aside className="sidebar">
        <span className="brand">
          Atalaia
          <small>Console</small>
        </span>

        <nav className="nav">
          {NAV.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => (isActive ? 'active' : '')}
            >
              <span>{item.label}</span>
              {tallies[item.to] ? <span className="tally">{tallies[item.to]}</span> : null}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-foot">
          <div>{stats.data ? `${stats.data.total} CVEs tracked` : 'connecting…'}</div>

          {/* One passkey is a single point of failure that looks fine right up
              until the device is gone. Said here, on every page, until there
              are two. */}
          {(session.credentialCount ?? 0) <= 1 ? (
            <NavLink to="/settings/account" className="sidebar-warning">
              Only one passkey — add another
            </NavLink>
          ) : null}

          <div className="muted">{session.user?.username}</div>
          <button
            style={{ marginTop: '0.4rem', width: '100%' }}
            onClick={async () => {
              await auth.logout();
              onAuthLost();
            }}
          >
            Sign out
          </button>
        </div>
      </aside>

      <main className="main">
        <Routes>
          <Route path="/" element={<Overview onAuthLost={onAuthLost} />} />
          <Route path="/vulnerabilities" element={<Vulnerabilities onAuthLost={onAuthLost} />} />
          <Route path="/vulnerabilities/:cveId" element={<VulnDetail onAuthLost={onAuthLost} />} />
          <Route path="/reports" element={<Reports onAuthLost={onAuthLost} />} />
          <Route path="/feeds" element={<Feeds onAuthLost={onAuthLost} />} />
          <Route path="/repositories" element={<Repositories onAuthLost={onAuthLost} />} />
          <Route path="/repositories/:id" element={<RepositoryDetail onAuthLost={onAuthLost} />} />
          {/* Organizations and owners are configuration: they live in Settings
              now, and the old links still land where they moved to. */}
          <Route path="/organizations" element={<Navigate to="/settings/organizations" replace />} />
          <Route path="/owners" element={<Navigate to="/settings/slack" replace />} />
          <Route path="/settings" element={<Settings onAuthLost={onAuthLost} session={session} />} />
          <Route
            path="/settings/:tab"
            element={<Settings onAuthLost={onAuthLost} session={session} />}
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

export function App() {
  const [session, setSession] = useState<SessionInfo | null>(null);

  const load = useCallback(() => {
    auth
      .session()
      .then(setSession)
      .catch(() => setSession({ authenticated: false }));
  }, []);

  useEffect(load, [load]);

  // Any 401 from the BFF drops the whole console back to the login screen,
  // rather than leaving individual panels showing an auth error.
  const onAuthLost = useCallback(() => setSession({ authenticated: false }), []);

  if (session === null) {
    return <div className="loading">Starting console…</div>;
  }

  if (!session.authenticated) {
    return <Login onAuthenticated={load} />;
  }

  return <Shell onAuthLost={onAuthLost} session={session} />;
}
