import React from 'react';
import { Box } from 'ink';
import { useStore } from '../../state/store.js';
import { MessageViewport } from './MessageViewport.js';
import { Editor } from './Editor.js';

export const ChatPage: React.FC = () => {
  const messages = useStore((s) => s.messages);
  const isRunning = useStore((s) => s.isRunning);

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box flexGrow={1}>
        <MessageViewport messages={messages} />
      </Box>
      <Editor isRunning={isRunning} />
    </Box>
  );
};
