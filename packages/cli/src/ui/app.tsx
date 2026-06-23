import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useApp, useInput, useStdout } from 'ink';
import { useStore } from './state/store.js';
import { useOrchestrator } from './hooks/useOrchestrator.js';
import { useAgentStatus } from './hooks/useAgentStatus.js';
import { MessageHistory } from './components/MessageHistory.js';
import { StatusBar } from './components/StatusBar.js';
import { InputBox } from './components/InputBox.js';
import { WelcomeBanner } from './components/WelcomeBanner.js';
import type { ExecutionStrategy } from './types/ui.js';

export const App: React.FC = () => {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [terminalWidth, setTerminalWidth] = useState(() => stdout.columns || 80);

  useEffect(() => {
    const handler = () => setTerminalWidth(stdout.columns);
    stdout.on('resize', handler);
    return () => { stdout.off('resize', handler); };
  }, [stdout]);

  const messages = useStore((s) => s.messages);
  const isRunning = useStore((s) => s.isRunning);
  const currentStrategy = useStore((s) => s.currentStrategy);
  const graphStats = useStore((s) => s.graphStats);
  const agentStatus = useStore((s) => s.agentStatus);
  const lastPrompt = useStore((s) => s.lastPrompt);
  const showGraphPanel = useStore((s) => s.showGraphPanel);
  const setStrategy = useStore((s) => s.setStrategy);
  const toggleGraphPanel = useStore((s) => s.toggleGraphPanel);
  const clearMessages = useStore((s) => s.clearMessages);

  const { run, cancel } = useOrchestrator();

  useAgentStatus();

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      if (isRunning) cancel();
      else exit();
    }
    if (key.ctrl && input === 'l') clearMessages();
    if (key.ctrl && input === 'g') toggleGraphPanel();
  });

  const handleSubmit = useCallback(
    (prompt: string, strategy: ExecutionStrategy) => run(prompt, strategy),
    [run]
  );

  const handleStrategyChange = useCallback(
    (s: ExecutionStrategy) => setStrategy(s),
    [setStrategy]
  );

  const showWelcome = messages.length === 0;

  return (
    <Box flexDirection="column" width={terminalWidth}>
      <StatusBar
        opencode={agentStatus.opencode}
        gemini={agentStatus.gemini}
        strategy={currentStrategy}
        graphStats={graphStats}
        isRunning={isRunning}
        terminalWidth={terminalWidth}
        version="1.0.0"
      />

      <Box flexDirection="column" flexGrow={1}>
        {showWelcome ? (
          <WelcomeBanner />
        ) : (
          <MessageHistory messages={messages} />
        )}
      </Box>

      {showGraphPanel && (
        <Box
          borderStyle="single"
          borderColor="blue"
          paddingX={1}
          paddingY={0}
          flexShrink={0}
          gap={1}
        >
          <Text color="blue" bold>
            📊 Graphify
          </Text>
          <Text dimColor>│</Text>
          <Text>
            N:<Text color="cyan">{graphStats.nodes}</Text>
          </Text>
          <Text dimColor>│</Text>
          <Text>
            E:<Text color="cyan">{graphStats.edges}</Text>
          </Text>
          <Text dimColor>│</Text>
          <Text>
            S:<Text color="cyan">{graphStats.strategy}</Text>
          </Text>
          {graphStats.duration !== undefined && (
            <>
              <Text dimColor>│</Text>
              <Text>
                D:<Text color="cyan">{(graphStats.duration / 1000).toFixed(1)}s</Text>
              </Text>
            </>
          )}
          {graphStats.toolsUsed !== undefined && (
            <>
              <Text dimColor>│</Text>
              <Text>
                T:<Text color="cyan">{graphStats.toolsUsed}</Text>
              </Text>
            </>
          )}
        </Box>
      )}

      <InputBox
        isRunning={isRunning}
        onSubmit={handleSubmit}
        lastPrompt={lastPrompt}
        currentStrategy={currentStrategy}
        onStrategyChange={handleStrategyChange}
      />
    </Box>
  );
};

export default App;
