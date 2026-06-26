import React from 'react';
import { Box, Text } from 'ink';

interface Props {
  isRunning: boolean;
}

export const Editor: React.FC<Props> = ({ isRunning }) => {
  return (
    <Box flexDirection="row" width="100%">
      <Text bold color="cyan">▸</Text>
      <Text> </Text>
      <Text dimColor>{'>> '}</Text>
      <Text wrap="truncate-end">
        {isRunning ? '…' : 'ask something'}
      </Text>
    </Box>
  );
};
