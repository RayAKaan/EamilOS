import React from 'react';
import { Box, Text } from 'ink';
import { useStore } from '../../../state/store';

export const Footer = () => {
  const { currentView } = useStore();
  
  const shortcuts: Record<string, string> = {
    dashboard: 'd:Dashboard r:Run a:Agents c:Config | ? Help',
    'task-runner': 'F5:Run F6:Pause F7:Stop Esc:Back',
    'agent-detail': 'r:Restart s:Stop l:Logs Esc:Back',
    config: '↑↓:Navigate Enter:Edit Esc:Back'
  };

  return (
    <Box height={1}>
      <Text dimColor>{currentView ? shortcuts[currentView] : shortcuts.dashboard}</Text>
    </Box>
  );
};