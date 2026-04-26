import React from 'react';
import { Box } from 'ink';
import type { View } from '../Router';

interface SplitViewProps {
  left: View;
  right: View;
  leftComponent: React.ReactNode;
  rightComponent: React.ReactNode;
}

export const SplitView: React.FC<SplitViewProps> = ({ left, right, leftComponent, rightComponent }) => {
  return (
    <Box flexDirection="row" flexGrow={1}>
      <Box flexDirection="column" flexGrow={1} borderStyle="round" marginRight={1}>
        <Box paddingX={2}>
          <React.Fragment>{left}</React.Fragment>
        </Box>
        <Box flexGrow={1}>{leftComponent}</Box>
      </Box>
      <Box flexDirection="column" flexGrow={1} borderStyle="round">
        <Box paddingX={2}>
          <React.Fragment>{right}</React.Fragment>
        </Box>
        <Box flexGrow={1}>{rightComponent}</Box>
      </Box>
    </Box>
  );
};