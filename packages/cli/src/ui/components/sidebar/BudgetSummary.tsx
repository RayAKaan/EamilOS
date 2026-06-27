import React from 'react';
import { Box, Text } from 'ink';
import { useStore } from '../../state/store.js';

export const BudgetSummary: React.FC = () => {
  const graphStats = useStore((s) => s.graphStats);

  const tokens = graphStats.toolsUsed !== undefined ? `${graphStats.toolsUsed} tools` : '—';
  const cost = graphStats.duration !== undefined ? `${(graphStats.duration / 1000).toFixed(1)}s` : '—';

  return (
    <Box flexDirection="column">
      <Text bold underline>Budget</Text>
      <Text dimColor>tokens: {tokens}</Text>
      <Text dimColor>cost: {cost}</Text>
    </Box>
  );
};
