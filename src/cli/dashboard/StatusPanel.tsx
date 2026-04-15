import React from 'react';
import { Panel } from './Panel.js';
import { HBar } from './HBar.js';
import { BLUE, STATUS_COLORS } from '../lib/colors.js';
import type { CountRow } from '../lib/stats.js';

interface StatusPanelProps {
  counts: CountRow[];
}

export function StatusPanel({ counts }: StatusPanelProps) {
  const max = Math.max(1, ...counts.map((c) => c.count));
  return (
    <Panel title="By Status" color={BLUE} flexGrow={1}>
      {counts.map((row) => (
        <HBar
          key={row.label}
          label={row.label}
          value={row.count}
          max={max}
          width={18}
          color={STATUS_COLORS[row.label]}
        />
      ))}
    </Panel>
  );
}
