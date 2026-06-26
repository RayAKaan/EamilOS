import React from 'react';
import { Box } from 'ink';
import { useStore } from '../state/store.js';
import { Sidebar } from '../components/sidebar/Sidebar.js';
import { ChatPage as ChatComponent } from '../components/chat/ChatPage.js';

export const ChatPage: React.FC = () => {
  const sidebarVisible = useStore((s) => s.sidebarVisible);

  return (
    <Box flexDirection="row" flexGrow={1}>
      <Box flexGrow={1}>
        <ChatComponent />
      </Box>
      {sidebarVisible && (
        <Sidebar />
      )}
    </Box>
  );
};
