import React from 'react';
import { Panel } from './Panel.js';
import { HBar } from './HBar.js';
import { AMBER, SEVERITY_COLORS } from '../lib/colors.js';
import type { CountRow } from '../lib/stats.js';

interface SeverityPanelProps {
  counts: CountRow[];
}

export function SeverityPanel({ counts }: SeverityPanelProps) {
  const max = Math.max(1, ...counts.map((c) => c.count));
  return (
    <Panel title="By Severity" color={AMBER} flexGrow={1}>
      {counts.map((row) => (
        <HBar
          key={row.label}
          label={row.label}
          value={row.count}
          max={max}
          width={18}
          color={SEVERITY_COLORS[row.label]}
        />
      ))}
    </Panel>
  );
}
