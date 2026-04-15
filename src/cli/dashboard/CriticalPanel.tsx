import React from 'react';
import { Box, Text } from 'ink';
import { Panel } from './Panel.js';
import { PINK, DIM, RED } from '../lib/colors.js';
import type { VulnRow } from '../lib/stats.js';

interface CriticalPanelProps {
  rows: VulnRow[];
  selected: number;
}

export function CriticalPanel({ rows, selected }: CriticalPanelProps) {
  return (
    <Panel title="Latest Critical (open)" color={PINK} flexGrow={1}>
      {rows.length === 0 ? (
        <Text color={DIM}>no open critical vulnerabilities</Text>
      ) : (
        rows.map((row, i) => {
          const isSel = i === selected;
          const seen = row.first_seen_at?.slice(0, 10) ?? '----------';
          const id = (row.cve_id ?? '').padEnd(18);
          const src = (row.source ?? '').padEnd(10);
          const title = (row.title ?? '').slice(0, 60);
          const marker = row.exploited ? '!' : ' ';
          return (
            <Box key={row.cve_id}>
              <Text color={isSel ? PINK : DIM}>{isSel ? '▶ ' : '  '}</Text>
              <Text color={RED} bold={isSel}>
                {marker}
              </Text>
              <Text color="white"> {id}</Text>
              <Text color={DIM}>{src}</Text>
              <Text>{seen} </Text>
              <Text>{title}</Text>
            </Box>
          );
        })
      )}
    </Panel>
  );
}
