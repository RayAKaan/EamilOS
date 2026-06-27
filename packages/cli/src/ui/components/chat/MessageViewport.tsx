import React from 'react';
import { Box } from 'ink';
import { MessageRenderer } from './MessageRenderer.js';
import { WelcomeScreen } from './WelcomeScreen.js';
import type { Message } from '../../types/ui.js';

interface Props {
  messages: Message[];
}

export const MessageViewport: React.FC<Props> = ({ messages }) => {
  if (messages.length === 0) {
    return <WelcomeScreen />;
  }

  return (
    <Box flexDirection="column" flexGrow={1}>
      {messages.map((msg) => (
        <MessageRenderer key={msg.id} message={msg} />
      ))}
    </Box>
  );
};
