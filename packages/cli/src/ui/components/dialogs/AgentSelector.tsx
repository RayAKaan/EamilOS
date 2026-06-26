import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { useStore } from '../../state/store.js';

const AGENTS = [
  { id: 'auto', label: 'Auto (detect)' },
  { id: 'local', label: 'Local (ollama, etc.)' },
  { id: 'cloud', label: 'Cloud (API)' },
  { id: 'cli', label: 'CLI Agents' },
];

export const AgentSelector: React.FC = () => {
  const [selected, setSelected] = useState(0);
  const setAgentFilter = useStore((s) => s.setAgentFilter);
  const closeOverlay = useStore((s) => s.closeOverlay);

  useInput((_input, key) => {
    if (key.return) {
      setAgentFilter(AGENTS[selected]!.id as 'auto' | 'local' | 'cloud' | 'cli');
      closeOverlay();
    } else if (key.escape) {
      closeOverlay();
    } else if (key.upArrow) {
      setSelected((p) => Math.max(0, p - 1));
    } else if (key.downArrow) {
      setSelected((p) => Math.min(AGENTS.length - 1, p + 1));
    }
  });

  return (
    <Box flexDirection="column">
      <Text bold>Select Agent Source</Text>
      {AGENTS.map((a, i) => (
        <Box key={a.id}>
          <Text color={i === selected ? 'cyan' : 'white'}>
            {i === selected ? '▸ ' : '  '}{a.label}
          </Text>
        </Box>
      ))}
    </Box>
  );
};
