import React, { useState, useEffect, useRef } from 'react';
import { Box, Text } from 'ink';
import { useKeyboard } from '../../hooks/useKeyboard';

interface Command {
  id: string;
  label: string;
  shortcut?: string;
  action: () => void;
}

interface HelpOverlayProps {
  onClose: () => void;
}

export const HelpOverlay: React.FC<HelpOverlayProps> = ({ onClose }) => {
  return (
    <Box flexDirection="column" padding={3}>
      <Text bold color="cyan">EamilOS Keyboard Shortcuts</Text>
      <Box>
        <Text>Navigation: </Text>
        <Text>d Dashboard | r Run Task | a Agents | c Config</Text>
      </Box>
      <Box>
        <Text>Tasks: </Text>
        <Text>F5 Run | F6 Pause | F7 Stop | Enter Select</Text>
      </Box>
      <Box>
        <Text>System: </Text>
        <Text>Ctrl+P Command Palette | Ctrl+\ Split | / Search</Text>
      </Box>
      <Box>
        <Text>General: </Text>
        <Text>? Help | q Quit | Esc Close</Text>
      </Box>
      <Text dimColor>Press any key to close</Text>
    </Box>
  );
};

interface CommandPaletteProps {
  bridge: any;
  onClose: () => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({ bridge, onClose }) => {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [search, setSearch] = useState('');

  const commands: Command[] = [
    { id: 'dashboard', label: 'Go to Dashboard', shortcut: 'd', action: () => { onClose(); } },
    { id: 'task-runner', label: 'Run New Task', shortcut: 'n', action: () => { onClose(); } },
    { id: 'agents', label: 'View Agents', shortcut: 'a', action: () => { onClose(); } },
    { id: 'config', label: 'Open Config', shortcut: 'c', action: () => { onClose(); } },
    { id: 'split', label: 'Toggle Split View', shortcut: '\\', action: () => { onClose(); } },
    { id: 'search', label: 'Search', shortcut: '/', action: () => { onClose(); } },
    { id: 'help', label: 'Show Help', shortcut: '?', action: () => { onClose(); } },
    { id: 'quit', label: 'Quit EamilOS', shortcut: 'q', action: () => bridge.shutdown().then(() => process.exit(0)) },
  ];

  const filteredCommands = commands.filter(cmd =>
    cmd.label.toLowerCase().includes(search.toLowerCase()) ||
    cmd.shortcut?.toLowerCase().includes(search.toLowerCase())
  );

  useKeyboard((keyId) => {
    const key = keyId.toLowerCase();
    if (key === 'escape') {
      onClose();
    } else if (key === 'arrowup') {
      setSelectedIndex(i => Math.max(0, i - 1));
    } else if (key === 'arrowdown') {
      setSelectedIndex(i => Math.min(filteredCommands.length - 1, i + 1));
    } else if (key === 'enter') {
      filteredCommands[selectedIndex]?.action();
    } else if (key.length === 1 && !key.includes('ctrl')) {
      const match = filteredCommands.find(cmd => cmd.shortcut === key);
      if (match) {
        match.action();
      } else {
        setSearch(s => s + key);
      }
    }
  });

  return (
    <Box flexDirection="column" padding={2} borderStyle="round" borderColor="cyan">
      <Text bold color="cyan">Command Palette</Text>
      <Box marginY={1}>
        <Text>{'>'} </Text>
        <Text inverse>{search || '_'}</Text>
      </Box>
      {filteredCommands.map((cmd, idx) => (
        <Box key={cmd.id}>
          <Text color={idx === selectedIndex ? 'cyan' : 'white'} bold={idx === selectedIndex}>
            {idx === selectedIndex ? '► ' : '  '}
          </Text>
          <Text color={idx === selectedIndex ? 'cyan' : 'white'}>{cmd.label}</Text>
          <Text dimColor> ({cmd.shortcut})</Text>
        </Box>
      ))}
      <Text dimColor>↑↓ Navigate • Enter Select • Esc Close</Text>
    </Box>
  );
};