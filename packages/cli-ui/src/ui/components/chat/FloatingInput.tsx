import React from 'react';
import { Box, Text } from 'ink';

interface FloatingInputProps {
  value: string;
  disabled?: boolean;
  agentName?: string;
  showSlashMenu?: boolean;
}

export const FloatingInput = ({
  value,
  disabled = false,
  agentName = 'Auto-select',
  showSlashMenu = false,
}: FloatingInputProps) => {
  const placeholder = disabled ? '(agent is thinking...)' : 'Type a message...';

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Box>
        <Text color={showSlashMenu ? 'yellow' : 'green'} bold>❯ </Text>
        <Text color={showSlashMenu ? 'yellow' : undefined}>
          {value || placeholder}
        </Text>
      </Box>
    </Box>
  );
};
