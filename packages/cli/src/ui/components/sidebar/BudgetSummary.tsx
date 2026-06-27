import React from 'react';
import { Box, Text } from 'ink';
import { useStore } from '../../state/store.js';

export const BudgetSummary: React.FC = () => {
  const graphStats = useStore((s) => s.graphStats);

  const filesOrTools = graphStats.toolsUsed !== undefined
    ? String(graphStats.toolsUsed)
    : '—';

  const duration = graphStats.duration !== undefined
    ? `${(graphStats.duration / 1000).toFixed(1)}s`
    : '—';

  const tokens = graphStats.tokensUsed !== undefined
    ? String(graphStats.tokensUsed)
    : '—';

  const cost = graphStats.actualCostUsd !== undefined
    ? `$${graphStats.actualCostUsd.toFixed(4)}`
    : graphStats.estimatedCostUsd !== undefined
      ? `~$${graphStats.estimatedCostUsd.toFixed(4)}`
      : '—';

  return (
    <Box flexDirection="column">
      <Text bold underline>Run Summary</Text>
      <Text dimColor>files/tools: {filesOrTools}</Text>
      <Text dimColor>duration: {duration}</Text>
      <Text dimColor>tokens: {tokens}</Text>
      <Text dimColor>cost: {cost}</Text>
      <Text dimColor>validated: {graphStats.validated ? 'yes' : '—'}</Text>
    </Box>
  );
};
