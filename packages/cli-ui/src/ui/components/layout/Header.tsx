import React from 'react';
import { Box, Text } from 'ink';

interface HeaderProps {
  mode: string;
  taskCount?: number;
  totalCost?: number;
}

export const Header = ({ mode, taskCount = 0, totalCost = 0 }: HeaderProps) => {
  return (
    <Box justifyContent="space-between" paddingX={2} paddingY={1}>
      <Box>
        <Text bold>EamilOS</Text>
        <Text dimColor> {mode === 'chat' ? 'Chat' : 'Power'}</Text>
      </Box>

      <Box>
        <Text dimColor>Tasks </Text>
        <Text bold>{taskCount}</Text>
        <Text>  </Text>
        <Text dimColor>Cost </Text>
        <Text color="green">${totalCost.toFixed(2)}</Text>
      </Box>
    </Box>
  );
};
