import React from 'react';
import { Box, useInput } from 'ink';
import { useStore } from './state/store.js';
import { Container } from './components/layout/Container.js';
import { DialogLayer } from './components/layout/DialogLayer.js';
import { StatusBar } from './components/StatusBar.js';
import { ChatPage } from './pages/ChatPage.js';
import { LogsPage } from './pages/LogsPage.js';
import { SessionsPage } from './pages/SessionsPage.js';
import { AgentsPage } from './pages/AgentsPage.js';

const PAGE_COMPONENTS: Record<string, React.FC> = {
  chat: ChatPage,
  logs: LogsPage,
  sessions: SessionsPage,
  agents: AgentsPage,
};

export const App: React.FC = () => {
  const activePage = useStore((s) => s.activePage);
  const isRunning = useStore((s) => s.isRunning);
  const openOverlay = useStore((s) => s.openOverlay);
  const closeOverlay = useStore((s) => s.closeOverlay);
  const setActivePage = useStore((s) => s.setActivePage);
  const setSidebarVisible = useStore((s) => s.setSidebarVisible);
  const sidebarVisible = useStore((s) => s.sidebarVisible);
  const activeOverlay = useStore((s) => s.activeOverlay);
  const clearMessages = useStore((s) => s.clearMessages);

  const PageComponent = PAGE_COMPONENTS[activePage] ?? ChatPage;

  useInput((input, key) => {
    if (activeOverlay) return;

    if (key.ctrl && input === 'c') {
      if (isRunning) {
        // cancel handled elsewhere
      } else {
        openOverlay('quit');
      }
      return;
    }

    if (key.ctrl && input === 'p') {
      openOverlay('command_palette');
      return;
    }

    if (key.ctrl && input === 'q') {
      openOverlay('quit');
      return;
    }

    if (key.ctrl && input === 's') {
      setSidebarVisible(!sidebarVisible);
      return;
    }

    if (key.ctrl && input === 'l') {
      clearMessages();
      return;
    }

    if (key.ctrl && input === 'n') {
      setActivePage('chat');
      clearMessages();
      return;
    }

    if (input === '1') { setActivePage('chat'); return; }
    if (input === '2') { setActivePage('logs'); return; }
    if (input === '3') { setActivePage('sessions'); return; }
    if (input === '4') { setActivePage('agents'); return; }

    if (input === '?') {
      openOverlay('help');
      return;
    }
  });

  return (
    <Container>
      <StatusBar />
      <Box flexGrow={1} height="100%">
        <PageComponent />
      </Box>
      <DialogLayer />
    </Container>
  );
};

export default App;
