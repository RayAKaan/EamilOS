import React from 'react';
import { Box } from 'ink';
import type { Message } from '../types/ui.js';
import { MessageBlock } from './MessageBlock.js';

interface MessageHistoryProps {
  messages: Message[];
}

export const MessageHistory: React.FC<MessageHistoryProps> = ({ messages }) => {
  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1} paddingTop={1}>
      {messages.map((msg) => (
        <MessageBlock key={msg.id} message={msg} />
      ))}
    </Box>
  );
};
