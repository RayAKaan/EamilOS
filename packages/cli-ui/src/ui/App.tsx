import React, { useState, useEffect } from 'react';
import { Box } from 'ink';
import { ChatMode } from './modes/ChatMode.js';
import { DashboardMode } from './modes/DashboardMode.js';
import { Header } from './components/layout/Header.js';

export type AppMode = 'chat' | 'dashboard';

interface AppProps {
  bridge: any;
  mode?: AppMode;
  onModeChange?: (mode: AppMode) => void;
}

export const App = ({ bridge, mode = 'chat', onModeChange }: AppProps) => {
  const [taskCount, setTaskCount] = useState(0);
  const [totalCost, setTotalCost] = useState(0);

  useEffect(() => {
    if (bridge.getState) {
      const state = bridge.getState();
      if (state?.tasks) setTaskCount(state.tasks.length);
    }
  }, [mode, bridge]);

  return (
    <Box flexDirection="column" width="100%" height="100%">
      <Header
        mode={mode}
        taskCount={taskCount}
        totalCost={totalCost}
      />

      {mode === 'chat' ? (
        <ChatMode
          bridge={bridge}
          onSwitchMode={(m) => onModeChange?.(m as AppMode)}
          taskCount={taskCount}
          totalCost={totalCost}
        />
      ) : (
        <DashboardMode
          bridge={bridge}
          onSwitchMode={(m) => onModeChange?.(m as AppMode)}
        />
      )}
    </Box>
  );
};

export default App;
