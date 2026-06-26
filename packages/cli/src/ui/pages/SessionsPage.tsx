import React from 'react';
import { Box, Text } from 'ink';
import { useStore } from '../state/store.js';

export const SessionsPage: React.FC = () => {
  const sessions = useStore((s) => s.sessions);

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Text bold underline>Session History</Text>
      {sessions.length === 0 && <Text dimColor>No saved sessions</Text>}
      {sessions.map((sess) => (
        <Box key={sess.id} flexDirection="column" marginY={0}>
          <Box>
            <Text color={sess.status === 'completed' ? 'green' : sess.status === 'failed' ? 'red' : 'yellow'}>
              {sess.status === 'completed' ? '✓' : sess.status === 'failed' ? '✗' : '●'}
            </Text>
            <Text> </Text>
            <Text bold>{sess.goal}</Text>
          </Box>
          <Box paddingLeft={3}>
            <Text dimColor>
              {sess.strategy} — {sess.messageCount} messages — {new Date(sess.startedAt).toLocaleString()}
            </Text>
          </Box>
        </Box>
      ))}
    </Box>
  );
};
