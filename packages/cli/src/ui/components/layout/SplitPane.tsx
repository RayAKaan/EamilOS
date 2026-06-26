import React from 'react';
import { Box } from 'ink';

interface Props {
  left: React.ReactNode;
  right: React.ReactNode;
  leftWidth: number;
  minLeftWidth?: number;
  minRightWidth?: number;
}

export const SplitPane: React.FC<Props> = ({
  left,
  right,
  leftWidth,
  minLeftWidth = 20,
  minRightWidth = 30,
}) => {
  const terminalWidth = process.stdout.columns ?? 120;
  const rightWidth = Math.max(terminalWidth - leftWidth - 1, minRightWidth);
  const actualLeft = Math.min(leftWidth, terminalWidth - minRightWidth);

  return (
    <Box flexDirection="row" width="100%" flexGrow={1}>
      <Box width={actualLeft} flexShrink={0}>
        {left}
      </Box>
      <Box width={1} flexShrink={0}>
      </Box>
      <Box flexGrow={1}>
        {right}
      </Box>
    </Box>
  );
};
