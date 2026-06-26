import React from 'react';
import { Box, Text } from 'ink';

export const BudgetSummary: React.FC = () => {
  return (
    <Box flexDirection="column">
      <Text bold underline>Budget</Text>
      <Text dimColor>tokens: —</Text>
      <Text dimColor>cost: —</Text>
    </Box>
  );
};
