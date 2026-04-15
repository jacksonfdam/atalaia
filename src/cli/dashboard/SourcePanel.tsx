import React from 'react';
import { Panel } from './Panel.js';
import { HBar } from './HBar.js';
import { GREEN } from '../lib/colors.js';
import type { CountRow } from '../lib/stats.js';

interface SourcePanelProps {
  counts: CountRow[];
}

export function SourcePanel({ counts }: SourcePanelProps) {
  const max = Math.max(1, ...counts.map((c) => c.count));
  return (
    <Panel title="By Source" color={GREEN} flexGrow={1}>
      {counts.length === 0 ? null : (
        counts.map((row) => (
          <HBar key={row.label} label={row.label} value={row.count} max={max} width={18} />
        ))
      )}
    </Panel>
  );
}
