import React from 'react';
import { Text } from 'ink';
import { Panel } from './Panel.js';
import { HBar } from './HBar.js';
import { MAGENTA, DIM } from '../lib/colors.js';
import type { CountRow } from '../lib/stats.js';

interface TechPanelProps {
  counts: CountRow[];
}

export function TechPanel({ counts }: TechPanelProps) {
  const max = Math.max(1, ...counts.map((c) => c.count));
  return (
    <Panel title="Top Technologies" color={MAGENTA} flexGrow={1}>
      {counts.length === 0 ? (
        <Text color={DIM}>no technology data</Text>
      ) : (
        counts.map((row) => (
          <HBar
            key={row.label}
            label={row.label}
            value={row.count}
            max={max}
            width={18}
            labelWidth={14}
          />
        ))
      )}
    </Panel>
  );
}
