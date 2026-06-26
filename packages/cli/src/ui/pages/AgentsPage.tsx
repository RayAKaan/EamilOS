import React from 'react';
import { Box, Text } from 'ink';
import { useStore } from '../state/store.js';

const STATUS_COLOR: Record<string, string> = {
  ready: 'green',
  busy: 'yellow',
  offline: 'gray',
  failed: 'red',
};

export const AgentsPage: React.FC = () => {
  const agents = useStore((s) => s.agentStatus);
  const terminals = useStore((s) => s.activeTerminals);

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Text bold underline>Detected Agents</Text>
      {Object.entries(agents).length === 0 && <Text dimColor>No agents detected</Text>}
      {Object.entries(agents).map(([id, info]) => (
        <Box key={id} flexDirection="column" marginY={0}>
          <Box>
            <Text color={STATUS_COLOR[info.status] ?? 'gray'}>
              {info.status === 'ready' ? '● ' : info.status === 'busy' ? '◉ ' : '○ '}
            </Text>
            <Text bold>{id}</Text>
            {info.version && <Text dimColor> v{info.version}</Text>}
          </Box>
          {info.error && (
            <Box paddingLeft={3}>
              <Text color="red">{info.error}</Text>
            </Box>
          )}
        </Box>
      ))}
      {terminals.length > 0 && (
        <>
          <Box height={1} />
          <Text bold underline>Active Terminals</Text>
          {terminals.map((t) => (
            <Box key={t.callsign}>
              <Text>{t.callsign}</Text>
              <Text dimColor> @{t.agentId}</Text>
            </Box>
          ))}
        </>
      )}
    </Box>
  );
};
