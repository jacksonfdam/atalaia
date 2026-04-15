import React from 'react';
import { Box, Text } from 'ink';
import { gradientAt, DIM } from '../lib/colors.js';

interface HBarProps {
  label: string;
  value: number;
  max: number;
  width?: number;
  labelWidth?: number;
  color?: string;
  /** Render the numeric value after the bar (default: true). */
  showValue?: boolean;
}

const FILLED = '█';
const EMPTY = '░';

export function HBar({
  label,
  value,
  max,
  width = 20,
  labelWidth = 12,
  color,
  showValue = true,
}: HBarProps) {
  const safeMax = max > 0 ? max : 1;
  const ratio = Math.max(0, Math.min(1, value / safeMax));
  const filled = Math.round(ratio * width);
  const empty = Math.max(0, width - filled);

  // If a single color is provided, use it flat; otherwise gradient per cell.
  const cells: React.ReactNode[] = [];
  for (let i = 0; i < filled; i++) {
    const cellColor = color ?? gradientAt(width > 1 ? i / (width - 1) : ratio);
    cells.push(
      <Text key={`f${i}`} color={cellColor}>
        {FILLED}
      </Text>
    );
  }
  if (empty > 0) {
    cells.push(
      <Text key="empty" color={DIM}>
        {EMPTY.repeat(empty)}
      </Text>
    );
  }

  const labelText = label.length > labelWidth ? label.slice(0, labelWidth) : label.padEnd(labelWidth);

  return (
    <Box>
      <Text>{labelText} </Text>
      {cells}
      {showValue && (
        <Text color="white"> {String(value).padStart(4)}</Text>
      )}
    </Box>
  );
}
