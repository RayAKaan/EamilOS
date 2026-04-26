import React from 'react';
import { Box, Text } from 'ink';
import { useStore } from '../../../state/store';

const shortcuts: Record<string, string> = {
  dashboard: 'd/1 Dashboard | r/2 Run | a/3 Agents | c/4 Config',
  'task-runner': 'Enter Run | Space Pause | x Stop | Esc Back',
  'agent-detail': 'r Restart | s Stop | l Logs | Esc Back',
  config: '↑↓ Navigate | Enter Edit | Esc Back'
};

export const Footer = () => {
  const { currentView } = useStore();
  
  return (
    <Box height={1}>
      <Text dimColor>{currentView ? shortcuts[currentView] || shortcuts.dashboard : shortcuts.dashboard} | h Help | p Palette | \\ Sidebar | q Quit</Text>
    </Box>
  );
};