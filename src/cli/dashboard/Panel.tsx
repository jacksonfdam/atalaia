import React from 'react';
import { Box, Text } from 'ink';

interface PanelProps {
  title: string;
  color: string;
  width?: number | string;
  flexGrow?: number;
  children: React.ReactNode;
}

export function Panel({ title, color, width, flexGrow, children }: PanelProps) {
  return (
    <Box
      borderStyle="round"
      borderColor={color}
      flexDirection="column"
      paddingX={1}
      width={width}
      flexGrow={flexGrow}
    >
      <Box>
        <Text bold color={color}>
          {title}
        </Text>
      </Box>
      <Box flexDirection="column" marginTop={0}>
        {children}
      </Box>
    </Box>
  );
}
