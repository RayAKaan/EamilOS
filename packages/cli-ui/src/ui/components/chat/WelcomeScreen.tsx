import React from 'react';
import { Box, Text } from 'ink';

interface WelcomeScreenProps {
  version?: string;
}

export const WelcomeScreen = ({ version = '1.2.7' }: WelcomeScreenProps) => {
  return (
    <Box
      flexGrow={1}
      alignItems="center"
      justifyContent="center"
      flexDirection="column"
      paddingX={4}
    >
      <Box marginBottom={2}>
        <Text bold>EamilOS</Text>
        <Text dimColor> v{version}</Text>
      </Box>
      <Box marginBottom={1}>
        <Text color="gray">Your AI agent fleet, ready to build.</Text>
      </Box>
      <Box>
        <Text dimColor>Type a message or press / for commands</Text>
      </Box>
    </Box>
  );
};
