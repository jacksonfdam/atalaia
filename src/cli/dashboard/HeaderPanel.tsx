import React from 'react';
import { Box, Text } from 'ink';
import { Panel } from './Panel.js';
import { ORANGE, RED, GOLD, DIM } from '../lib/colors.js';
import type { SummaryStats } from '../lib/stats.js';

function formatAgo(iso: string | null): string {
  if (!iso) return 'never';
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return iso;
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

interface HeaderPanelProps {
  stats: SummaryStats;
  refreshSeconds: number;
}

export function HeaderPanel({ stats, refreshSeconds }: HeaderPanelProps) {
  return (
    <Panel title="Atalaia" color={ORANGE} flexGrow={1}>
      <Box flexDirection="row" gap={3}>
        <Box flexDirection="column">
          <Text color={DIM}>total</Text>
          <Text bold color={GOLD}>
            {stats.total.toLocaleString()}
          </Text>
        </Box>
        <Box flexDirection="column">
          <Text color={DIM}>open</Text>
          <Text bold color={ORANGE}>
            {stats.open.toLocaleString()}
          </Text>
        </Box>
        <Box flexDirection="column">
          <Text color={DIM}>critical (open)</Text>
          <Text bold color={RED}>
            {stats.critical.toLocaleString()}
          </Text>
        </Box>
        <Box flexDirection="column">
          <Text color={DIM}>exploited (open)</Text>
          <Text bold color={RED}>
            {stats.exploited.toLocaleString()}
          </Text>
        </Box>
        <Box flexDirection="column">
          <Text color={DIM}>ack</Text>
          <Text color={GOLD}>{stats.acknowledged.toLocaleString()}</Text>
        </Box>
        <Box flexDirection="column">
          <Text color={DIM}>resolved</Text>
          <Text color="greenBright">{stats.resolved.toLocaleString()}</Text>
        </Box>
        <Box flexDirection="column" flexGrow={1} alignItems="flex-end">
          <Text color={DIM}>last seen</Text>
          <Text>{formatAgo(stats.lastSeenAt)}</Text>
        </Box>
        <Box flexDirection="column" alignItems="flex-end">
          <Text color={DIM}>refresh</Text>
          <Text>{refreshSeconds}s</Text>
        </Box>
      </Box>
    </Panel>
  );
}
