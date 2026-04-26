import React from 'react';
import { Box, Text } from 'ink';
import { useStore } from '../../../state/store';

export const Header = () => {
  const { agents, costPerHour, queueLength, healthy, degradedNodes } = useStore();
  
  React.useEffect(() => {
    useStore.getState().setMetrics({ costPerHour: 1.23, queueLength: 3, healthy: true, degradedNodes: 0 });
  }, []);

  return (
    <Box flexDirection="column" height={2}>
      <Box>
        <Text bold color="cyan">⚡ EamilOS v1.0.0</Text>
        <Text> | </Text>
        <Text color="yellow">Mode: Auto</Text>
        <Text> | </Text>
        <Text color="green">🟢 {agents.length} agents</Text>
        <Text> | </Text>
        <Text color="magenta">💰 ${costPerHour}/hr</Text>
      </Box>
      <Box>
        <Text dimColor>
          {healthy ? '🟢 Healthy' : '🔴 Issues'} | 
          Queue: {queueLength} | 
          {degradedNodes > 0 && `⚠️ ${degradedNodes} nodes degraded`}
        </Text>
      </Box>
    </Box>
  );
};