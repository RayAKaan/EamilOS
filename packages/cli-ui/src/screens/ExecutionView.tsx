import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { ExecutionGraph } from '../components/ExecutionGraph';
import { createMockExecutionTree, createMockBlockedTree, createDeepMockTree } from '../utils/mockData';
import { useStore } from '../state/store';

type MockMode = 'normal' | 'blocked' | 'deep';

const LogViewer: React.FC = () => {
  const logs = useStore(state => state.logs);
  return (
    <Box flexDirection="column" flexGrow={1}>
      {logs.slice(-10).map(log => (
        <Text key={log.id} color={log.level === 'error' ? 'red' : 'white'}>
          {log.message}
        </Text>
      ))}
      {logs.length === 0 && (
        <Text dimColor>No logs yet</Text>
      )}
    </Box>
  );
};

export const ExecutionView: React.FC = () => {
  const [tree, setTree] = useState<any>(null);
  const [mode, setMode] = useState<MockMode>('normal');

  const isRunning = useStore(state => state.isRunning);

  const loadMock = () => {
    switch (mode) {
      case 'blocked':
        setTree(createMockBlockedTree());
        break;
      case 'deep':
        setTree(createDeepMockTree());
        break;
      default:
        setTree(createMockExecutionTree());
    }
  };

  const cycleMode = () => {
    setMode((m) => {
      const modes: MockMode[] = ['normal', 'blocked', 'deep'];
      const nextIndex = (modes.indexOf(m) + 1) % modes.length;
      return modes[nextIndex];
    });
  };

  const clearTree = () => setTree(null);

  return (
    <Box flexDirection="column" height="100%" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">EamilOS Execution View</Text>
        <Text dimColor> | Mock Mode</Text>
      </Box>

      <Box marginBottom={1} flexDirection="row" gap={2}>
        <Text dimColor>Shortcuts:</Text>
        <Text><Text color="cyan">M</Text> Mode</Text>
        <Text><Text color="cyan">L</Text> Load</Text>
        <Text><Text color="cyan">C</Text> Clear</Text>
      </Box>

      <Box flexGrow={1} flexDirection="row" gap={1}>
        <Box flexBasis="60%">
          <ExecutionGraph root={tree} maxHeight={25} />
        </Box>

        <Box 
          flexBasis="40%" 
          borderStyle="round" 
          borderColor="gray"
          padding={1}
          height={25}
        >
          <Text bold dimColor>Logs</Text>
          <LogViewer />
        </Box>
      </Box>

      <Box marginTop={1} borderStyle="round" borderColor="gray" padding={1}>
        <Text dimColor>
          Mode: {mode} | 
          Nodes: {tree ? countNodes(tree) : 0} |
          Status: {isRunning ? 'Running' : 'Idle'}
        </Text>
      </Box>
    </Box>
  );
};

function countNodes(node: any): number {
  return 1 + (node.children?.reduce((sum: number, child: any) => sum + countNodes(child), 0) || 0);
}
