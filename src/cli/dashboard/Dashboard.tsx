import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text, useApp, useInput, useStdin, useStdout } from 'ink';
import { DIM, ORANGE } from '../lib/colors.js';
import { createClient } from '../lib/api.js';
import {
  fetchStats,
  countBySeverity,
  countByStatus,
  countBySource,
  topTechnologies,
  recentActivity,
  latestCritical,
  summaryStats,
  type ActivityRow,
  type CountRow,
  type SummaryStats,
  type VulnRow,
} from '../lib/stats.js';
import { HeaderPanel } from './HeaderPanel.js';
import { SeverityPanel } from './SeverityPanel.js';
import { StatusPanel } from './StatusPanel.js';
import { SourcePanel } from './SourcePanel.js';
import { TechPanel } from './TechPanel.js';
import { ActivityPanel } from './ActivityPanel.js';
import { CriticalPanel } from './CriticalPanel.js';

interface Snapshot {
  summary: SummaryStats;
  severity: CountRow[];
  status: CountRow[];
  source: CountRow[];
  tech: CountRow[];
  activity: ActivityRow[];
  critical: VulnRow[];
  readAt: string;
}

async function loadSnapshot(): Promise<Snapshot> {
  const api = createClient();

  // One /stats call feeds every panel but the critical list: the counting is
  // done in SQL on the server, so a refresh is two requests rather than a
  // table scan per panel.
  const [stats, critical] = await Promise.all([fetchStats(api), latestCritical(api, 5)]);

  return {
    summary: summaryStats(stats),
    severity: countBySeverity(stats),
    status: countByStatus(stats),
    source: countBySource(stats),
    tech: topTechnologies(stats, 8),
    activity: recentActivity(stats, 7),
    critical,
    readAt: new Date().toISOString(),
  };
}

interface DashboardProps {
  refreshSeconds: number;
}

export function Dashboard({ refreshSeconds }: DashboardProps) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const { isRawModeSupported } = useStdin();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState(0);
  const [tick, setTick] = useState(0);

  const columns = stdout?.columns ?? 120;
  const wide = columns >= 120;

  useEffect(() => {
    let cancelled = false;

    const refresh = async () => {
      try {
        const next = await loadSnapshot();
        if (cancelled) return;
        setSnapshot(next);
        setError(null);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    };
    refresh();
    const id = setInterval(refresh, Math.max(1, refreshSeconds) * 1000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [refreshSeconds, tick]);

  useInput(
    (input, key) => {
      if (input === 'q' || (key.ctrl && input === 'c')) exit();
      if (input === 'r') setTick((t) => t + 1);
      if (key.upArrow) setSelected((s) => Math.max(0, s - 1));
      if (key.downArrow) {
        const max = snapshot?.critical.length ?? 0;
        setSelected((s) => Math.min(Math.max(0, max - 1), s + 1));
      }
    },
    { isActive: isRawModeSupported }
  );

  if (error) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="red" bold>
          Dashboard error
        </Text>
        <Text>{error}</Text>
        <Text color={DIM}>Press q to quit, r to retry.</Text>
      </Box>
    );
  }

  if (!snapshot) {
    return (
      <Box padding={1}>
        <Text color={ORANGE}>loading…</Text>
      </Box>
    );
  }

  const clampedSelected = Math.min(selected, Math.max(0, snapshot.critical.length - 1));

  const severityBlock = <SeverityPanel counts={snapshot.severity} />;
  const statusBlock = <StatusPanel counts={snapshot.status} />;
  const sourceBlock = <SourcePanel counts={snapshot.source} />;
  const techBlock = <TechPanel counts={snapshot.tech} />;
  const activityBlock = <ActivityPanel rows={snapshot.activity} />;
  const criticalBlock = <CriticalPanel rows={snapshot.critical} selected={clampedSelected} />;

  return (
    <Box flexDirection="column" width={Math.min(columns, 180)}>
      <HeaderPanel stats={snapshot.summary} refreshSeconds={refreshSeconds} />

      {wide ? (
        <>
          <Box flexDirection="row">
            {severityBlock}
            {statusBlock}
          </Box>
          <Box flexDirection="row">
            {sourceBlock}
            {techBlock}
          </Box>
          <Box flexDirection="row">{activityBlock}</Box>
          <Box flexDirection="row">{criticalBlock}</Box>
        </>
      ) : (
        <>
          {severityBlock}
          {statusBlock}
          {sourceBlock}
          {techBlock}
          {activityBlock}
          {criticalBlock}
        </>
      )}

      <Box paddingX={1}>
        <Text color={DIM}>
          q quit · r refresh · ↑/↓ scroll critical · snapshot @{' '}
          {snapshot.readAt.slice(11, 19)}
        </Text>
      </Box>
    </Box>
  );
}
