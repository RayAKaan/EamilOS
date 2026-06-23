import React from 'react';
import { Box, Text } from 'ink';
import type { Message } from '../types/ui.js';

interface UserMessageProps {
  message: Message;
}

const formatTime = (ts: number): string => {
  const d = new Date(ts);
  return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
};

export const UserMessage: React.FC<UserMessageProps> = ({ message }) => {
  const time = formatTime(message.timestamp);

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor="green"
      paddingX={1}
      paddingY={0}
      marginBottom={1}
    >
      <Box justifyContent="space-between" marginBottom={1}>
        <Box gap={1}>
          <Text color="green" bold>
            👤 YOU
          </Text>
        </Box>
        <Text dimColor>{time}</Text>
      </Box>
      <Box paddingLeft={1}>
        <Text color="white">{message.content}</Text>
      </Box>
    </Box>
  );
};
