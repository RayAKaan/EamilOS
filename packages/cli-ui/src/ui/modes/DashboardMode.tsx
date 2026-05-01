import React from 'react';
import { Box, Text } from 'ink';
import { Dashboard } from '../views/Dashboard.js';

interface DashboardModeProps {
  bridge: any;
  onSwitchMode: (mode: string) => void;
}

export const DashboardMode = ({ bridge, onSwitchMode }: DashboardModeProps) => {
  return (
    <Box flexDirection="column" height="100%">
      <Box paddingX={2} paddingY={1}>
        <Text bold color="magenta">Power Mode</Text>
        <Text dimColor>  Tab to return to chat</Text>
      </Box>

      <Box flexGrow={1}>
        <Dashboard
          bridge={bridge}
          onSelectAgent={() => {}}
          onSelectTask={() => {}}
        />
      </Box>

      <Box paddingX={2} paddingY={1}>
        <Text dimColor>Tab: chat  d: dashboard  r: run  h: help</Text>
      </Box>
    </Box>
  );
};
