import React from 'react';
import { Box } from 'ink';
import { Header } from './components/layout/Header';
import { Footer } from './components/layout/Footer';
import { Sidebar } from './components/layout/Sidebar';
import { Router } from './Router';
import { useStore } from '../state/store';
import type { UIBridge } from '../bridge';

export const App = ({ bridge }: { bridge: UIBridge }) => {
  return (
    <Box flexDirection="column" width="100%" height="100%">
      <Header />
      <Box flexGrow={1} flexDirection="row">
        <Sidebar />
        <Box flexGrow={1}>
          <Router bridge={bridge} />
        </Box>
      </Box>
      <Footer />
    </Box>
  );
};

export default App;