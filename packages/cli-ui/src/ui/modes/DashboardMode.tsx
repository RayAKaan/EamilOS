import React from 'react';
import { Box, Text } from 'ink';
import { Dashboard } from '../views/Dashboard';
import { Header } from '../components/layout/Header';
import { Footer } from '../components/layout/Footer';

interface DashboardModeProps {
  bridge: any;
  onSwitchMode: (mode: string) => void;
}

export const DashboardMode = ({ bridge, onSwitchMode }: DashboardModeProps) => {
  return (
    <Box flexDirection="column" height="100%">
      <Box borderStyle="round" borderColor="magenta" paddingX={1} marginBottom={1}>
        <Text color="magenta" bold>🔧 Power Mode</Text>
        <Text dimColor> | Press Tab to return to chat</Text>
      </Box>
      
      <Box flexGrow={1} borderStyle="round" borderColor="cyan">
        <Dashboard 
          bridge={bridge} 
          onSelectAgent={() => {}} 
          onSelectTask={() => {}} 
        />
      </Box>
      
      <Box borderStyle="round" borderColor="gray" paddingX={1} height={1}>
        <Text dimColor>Tab: chat | d: dashboard | r: run | h: help</Text>
      </Box>
    </Box>
  );
};