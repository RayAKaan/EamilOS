import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { ChatMode } from './modes/ChatMode';
import { DashboardMode } from './modes/DashboardMode';

export type AppMode = 'chat' | 'dashboard';

export const App = ({ bridge }: { bridge: any }) => {
  const [mode, setMode] = useState<AppMode>('chat');

  return (
    <Box flexDirection="column" width="100%" height="100%">
      {mode === 'chat' ? (
        <ChatMode bridge={bridge} onSwitchMode={(m: string) => setMode(m as AppMode)} />
      ) : (
        <DashboardMode bridge={bridge} onSwitchMode={(m: string) => setMode(m as AppMode)} />
      )}
    </Box>
  );
};

export default App;