import React from 'react';
import { Box, Text } from 'ink';
import { Router } from './ui/Router';
import { createBridge } from './bridge';

interface AppProps {
  bridge?: any;
}

export const App: React.FC<AppProps> = ({ bridge: providedBridge }) => {
  const [bridge, setBridge] = React.useState<any>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [initialized, setInitialized] = React.useState(false);

  React.useEffect(() => {
    const init = async () => {
      try {
        const b = providedBridge || createBridge({ mockMode: true });
        await b.initialize();
        setBridge(b);
        setInitialized(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to initialize');
      }
    };
    init();

    return () => {
      bridge?.shutdown();
    };
  }, []);

  if (error) {
    return (
      <Box flexDirection="column" alignItems="center" justifyContent="center" height="100%">
        <Text color="red" bold>Initialization Error</Text>
        <Text>{error}</Text>
      </Box>
    );
  }

  if (!initialized || !bridge) {
    return (
      <Box flexDirection="column" alignItems="center" justifyContent="center" height="100%">
        <Text color="cyan" bold>EamilOS</Text>
        <Text dimColor>Initializing...</Text>
      </Box>
    );
  }

  return <Router bridge={bridge} />;
};

export default App;