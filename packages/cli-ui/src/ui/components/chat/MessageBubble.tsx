import React from 'react';
import { Box, Text } from 'ink';
import { useFadeIn } from '../../hooks/useFadeIn.js';

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  agent?: string;
  duration?: string;
  metrics?: { tokens?: number; cost?: number; duration?: number };
}

interface MessageBubbleProps {
  message: Message;
}

export const MessageBubble = ({ message }: MessageBubbleProps) => {
  const isUser = message.role === 'user';
  const isAgent = message.role === 'assistant';

  return (
    <Box
      flexDirection="column"
      justifyContent={isUser ? 'flex-end' : 'flex-start'}
      marginBottom={1}
      paddingX={1}
    >
      <Box flexDirection="column">
        <Box>
          {!isUser && (
            <Box marginRight={1}>
              <Text bold color="cyan">
                {message.agent || 'Agent'}:
              </Text>
            </Box>
          )}
          {isUser && (
            <Box marginRight={1}>
              <Text bold color="green">
                You:
              </Text>
            </Box>
          )}
          <Text wrap="wrap">{message.content}</Text>
        </Box>

        {isAgent && (message.duration || message.metrics) && (
          <Box marginTop={1}>
            {message.duration && (
              <Text dimColor>{message.duration}</Text>
            )}
            {message.metrics?.cost != null && (
              <>
                <Text dimColor>  </Text>
                <Text dimColor>${message.metrics.cost.toFixed(4)}</Text>
              </>
            )}
            {message.metrics?.tokens != null && (
              <>
                <Text dimColor>  </Text>
                <Text dimColor>{message.metrics.tokens.toLocaleString()} tokens</Text>
              </>
            )}
          </Box>
        )}
      </Box>
    </Box>
  );
};

export const SystemMessage = ({ content }: { content: string }) => {
  const lines = content.split('\n');
  return (
    <Box paddingX={2} paddingY={1} flexDirection="column">
      {lines.map((line, i) => (
        <Box key={i}>
          <Text dimColor>{line}</Text>
        </Box>
      ))}
    </Box>
  );
};
