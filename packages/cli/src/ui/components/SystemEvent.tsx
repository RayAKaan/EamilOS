import React from 'react';
import { Box, Text } from 'ink';
import type { Message } from '../types/ui.js';

interface SystemEventProps {
  message: Message;
}

const formatTime = (ts: number): string => {
  const d = new Date(ts);
  return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
};

export const SystemEvent: React.FC<SystemEventProps> = ({ message }) => {
  const time = formatTime(message.timestamp);
  const isError = message.type === 'error';
  const borderColor = isError ? 'red' : 'yellow';
  const icon = isError ? '❌' : '⚡';

  const lines = message.content
    ? message.content.split('\n').filter(Boolean)
    : message.eventLabel
    ? [message.eventLabel]
    : [];

  if (lines.length === 0) return null;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={borderColor}
      paddingX={1}
      paddingY={0}
      marginBottom={1}
    >
      <Box justifyContent="space-between">
        <Box flexDirection="column" gap={0}>
          {lines.map((line, i) => (
            <Box key={i} gap={1}>
              <Text color={isError ? 'red' : 'yellow'}>{icon}</Text>
              <Text color={isError ? 'red' : 'white'}>{line}</Text>
            </Box>
          ))}
        </Box>
        <Text dimColor>{time}</Text>
      </Box>
    </Box>
  );
};
