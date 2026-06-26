import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { useStore } from '../../state/store.js';

const COMMANDS = [
  { id: 'chat', label: 'Chat', page: 'chat' as const },
  { id: 'logs', label: 'Logs', page: 'logs' as const },
  { id: 'sessions', label: 'Sessions', page: 'sessions' as const },
  { id: 'agents', label: 'Agents', page: 'agents' as const },
  { id: 'clear', label: 'Clear Messages' },
  { id: 'help', label: 'Help' },
];

export const CommandPalette: React.FC = () => {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const setActivePage = useStore((s) => s.setActivePage);
  const closeOverlay = useStore((s) => s.closeOverlay);
  const clearMessages = useStore((s) => s.clearMessages);

  const filtered = COMMANDS.filter(
    (c) => c.label.toLowerCase().includes(query.toLowerCase())
  );

  useInput((input, key) => {
    if (key.return) {
      const cmd = filtered[selected];
      if (cmd) {
        if ('page' in cmd && cmd.page) {
          setActivePage(cmd.page);
        } else if (cmd.id === 'clear') {
          clearMessages();
        }
      }
      closeOverlay();
    } else if (key.escape) {
      closeOverlay();
    } else if (key.upArrow) {
      setSelected((p) => Math.max(0, p - 1));
    } else if (key.downArrow) {
      setSelected((p) => Math.min(filtered.length - 1, p + 1));
    } else if (key.backspace || key.delete) {
      setQuery((p) => p.slice(0, -1));
    } else if (input && input.length === 1) {
      setQuery((p) => p + input);
    }
  });

  return (
    <Box flexDirection="column" minWidth={50}>
      <Text bold>Command Palette</Text>
      <Box>
        <Text>{'> '}</Text>
        <Text>{query}</Text>
      </Box>
      {filtered.map((cmd, i) => (
        <Box key={cmd.id}>
          <Text color={i === selected ? 'cyan' : 'white'}>
            {i === selected ? '▸ ' : '  '}{cmd.label}
          </Text>
        </Box>
      ))}
    </Box>
  );
};
