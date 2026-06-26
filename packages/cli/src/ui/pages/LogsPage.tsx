import React from 'react';
import { Box, Text } from 'ink';
import { useStore } from '../state/store.js';

export const LogsPage: React.FC = () => {
  const logs = useStore((s) => s.logs);

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Text bold underline>Session Logs</Text>
      {logs.length === 0 && <Text dimColor>No logs yet</Text>}
      {logs.map((entry, i) => (
        <Text key={i} wrap="wrap">{entry}</Text>
      ))}
    </Box>
  );
};
