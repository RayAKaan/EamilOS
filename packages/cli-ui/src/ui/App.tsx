import React from 'react';
import { Box } from 'ink';
import { Header } from './components/layout/Header';
import { Footer } from './components/layout/Footer';
import { Sidebar } from './components/layout/Sidebar';
import { Router } from './Router';
import { getBorderConfig } from './themes/default';

export const App = ({ bridge }: { bridge: any }) => {
  return (
    <Box flexDirection="column" width="100%" height="100%">
      <Box {...getBorderConfig('panel')} borderBottom>
        <Header />
      </Box>
      
      <Box flexGrow={1} flexDirection="row">
        <Box {...getBorderConfig('panel')} borderRight>
          <Sidebar />
        </Box>
        
        <Box flexGrow={1} {...getBorderConfig('section')}>
          <Router bridge={bridge} />
        </Box>
      </Box>
      
      <Box {...getBorderConfig('panel')} borderTop>
        <Footer />
      </Box>
    </Box>
  );
};

export default App;