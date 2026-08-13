import { useCallback, useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { auth } from './api/client';
import { useApi } from './hooks/useApi';
import { Login } from './pages/Login';
import { Overview } from './pages/Overview';
import { Vulnerabilities } from './pages/Vulnerabilities';
import { VulnDetail } from './pages/VulnDetail';
import { Feeds } from './pages/Feeds';
import { Organizations } from './pages/Organizations';
import { Repositories } from './pages/Repositories';
import { Owners } from './pages/Owners';
import { Settings } from './pages/Settings';
import type { FeedHealthReport, Stats } from './types';

const NAV = [
  { to: '/', label: 'Overview', end: true },
  { to: '/vulnerabilities', label: 'Vulnerabilities' },
  { to: '/feeds', label: 'Sources' },
  { to: '/organizations', label: 'Organizations' },
  { to: '/repositories', label: 'Repositories' },
  { to: '/owners', label: 'Owners' },
  { to: '/settings', label: 'Settings' },
];

function Shell({ onAuthLost }: { onAuthLost: () => void }) {
  const stats = useApi<Stats>('/stats', onAuthLost);
  const health = useApi<FeedHealthReport>('/feeds/health', onAuthLost);

  const degraded = (health.data?.feeds ?? []).filter(
    feed => feed.status === 'ERROR' || feed.status === 'EMPTY'
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
          <Route path="/feeds" element={<Feeds onAuthLost={onAuthLost} />} />
          <Route path="/organizations" element={<Organizations onAuthLost={onAuthLost} />} />
          <Route path="/repositories" element={<Repositories onAuthLost={onAuthLost} />} />
          <Route path="/owners" element={<Owners onAuthLost={onAuthLost} />} />
          <Route path="/settings" element={<Settings onAuthLost={onAuthLost} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

export function App() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);

  useEffect(() => {
    auth.session().then(setAuthenticated);
  }, []);

  // Any 401 from the BFF drops the whole console back to the login screen,
  // rather than leaving individual panels showing an auth error.
  const onAuthLost = useCallback(() => setAuthenticated(false), []);

  if (authenticated === null) {
    return <div className="loading">Starting console…</div>;
  }

  if (!authenticated) {
    return <Login onAuthenticated={() => setAuthenticated(true)} />;
  }

  return <Shell onAuthLost={onAuthLost} />;
}
