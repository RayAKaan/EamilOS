import React from 'react';
import { Box, Text } from 'ink';
import { ChatMode } from './modes/ChatMode';
import { DashboardMode } from './modes/DashboardMode';

export type AppMode = 'chat' | 'dashboard';

interface AppProps {
  bridge: any;
  mode?: AppMode;
  onModeChange?: (mode: AppMode) => void;
  lastKey?: string;
}

export const App = ({ bridge, mode = 'chat', onModeChange }: AppProps) => {
  return (
    <Box flexDirection="column" width="100%" height="100%">
      {mode === 'chat' ? (
        <ChatMode bridge={bridge} onSwitchMode={(m) => onModeChange?.(m as AppMode)} />
      ) : (
        <DashboardMode bridge={bridge} onSwitchMode={(m) => onModeChange?.(m as AppMode)} />
      )}
    </Box>
  );
};

export default App;