import React from 'react';
import { Box, Text } from 'ink';
import { Panel } from './Panel.js';
import { CYAN, DIM, gradientAt } from '../lib/colors.js';
import type { ActivityRow } from '../lib/stats.js';

// Unicode block ramp for a compact sparkline-style bar.
const RAMP = [' ', '▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

interface ActivityPanelProps {
  rows: ActivityRow[];
}

export function ActivityPanel({ rows }: ActivityPanelProps) {
  const max = Math.max(1, ...rows.map((r) => r.count));

  return (
    <Panel title="Recent Activity (new vulns / day)" color={CYAN} flexGrow={1}>
      {rows.map((row) => {
        const ratio = row.count / max;
        const idx = Math.min(RAMP.length - 1, Math.round(ratio * (RAMP.length - 1)));
        const glyph = RAMP[idx];
        const color = row.count === 0 ? DIM : gradientAt(ratio);
        // Show day as short "Mon 04-15".
        const d = new Date(row.date + 'T00:00:00Z');
        const weekday = d.toLocaleDateString('en-US', {
          weekday: 'short',
          timeZone: 'UTC',
        });
        const label = `${weekday} ${row.date.slice(5)}`;
        return (
          <Box key={row.date}>
            <Text>{label.padEnd(12)} </Text>
            <Text color={color}>{glyph.repeat(Math.max(1, Math.round(ratio * 18)))}</Text>
            <Text color="white"> {String(row.count).padStart(4)}</Text>
          </Box>
        );
      })}
    </Panel>
  );
}
