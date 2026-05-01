import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';

interface TypingIndicatorProps {
  agentName: string;
}

export const TypingIndicator = ({ agentName }: TypingIndicatorProps) => {
  const [dots, setDots] = useState(1);

  useEffect(() => {
    const interval = setInterval(() => setDots(d => (d % 3) + 1), 400);
    return () => clearInterval(interval);
  }, []);

  return (
    <Box paddingX={2} paddingY={1}>
      <Text color="cyan">{agentName}</Text>
      <Text> </Text>
      <Text dimColor>thinking{'.'.repeat(dots)}</Text>
    </Box>
  );
};
