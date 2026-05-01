import React from 'react';
import { Box, Text } from 'ink';
import { useStore } from '../../../state/store.js';

const shortcuts: Record<string, string> = {
  dashboard: 'd Dashboard  r Run  a Agents  c Config',
  'task-runner': 'Enter Run  Space Pause  x Stop  Esc Back',
  'agent-detail': 'r Restart  s Stop  l Logs  Esc Back',
  config: 'Enter Edit  Esc Back',
};

export const Footer = () => {
  const { currentView } = useStore();

  const viewShortcuts = currentView ? shortcuts[currentView] || shortcuts.dashboard : shortcuts.dashboard;

  return (
    <Box paddingX={2} paddingY={1}>
      <Text dimColor>{viewShortcuts}  h Help  p Palette  q Quit</Text>
    </Box>
  );
};
