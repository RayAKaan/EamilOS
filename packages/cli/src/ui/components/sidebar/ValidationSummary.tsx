import React from 'react';
import { Box, Text } from 'ink';

export const ValidationSummary: React.FC = () => {
  const errors: string[] = [];

  return (
    <Box flexDirection="column">
      <Text bold underline>Validation</Text>
      {errors.length === 0 && <Text dimColor>passing</Text>}
      {errors.map((e, i) => (
        <Text key={i} color="red">{e}</Text>
      ))}
    </Box>
  );
};
