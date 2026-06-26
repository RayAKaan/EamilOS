import React from 'react';
import { Box, Text } from 'ink';
import { useStore } from '../../state/store.js';

const STATUS_DOT: Record<string, string> = {
  ready: '●',
  busy: '◉',
  offline: '○',
  failed: '⊗',
};

const STATUS_COLOR: Record<string, string> = {
  ready: 'green',
  busy: 'yellow',
  offline: 'gray',
  failed: 'red',
};

export const AgentRoster: React.FC = () => {
  const agents = useStore((s) => s.agentStatus);

  const entries = Object.entries(agents);

  return (
    <Box flexDirection="column">
      <Text bold underline>Agents</Text>
      {entries.length === 0 && <Text dimColor>none detected</Text>}
      {entries.map(([id, info]) => (
        <Box key={id}>
          <Text color={STATUS_COLOR[info.status] ?? 'gray'}>
            {STATUS_DOT[info.status] ?? '○'}
          </Text>
          <Text> </Text>
          <Text>{id}</Text>
          {info.version && <Text dimColor> v{info.version}</Text>}
        </Box>
      ))}
    </Box>
  );
};
