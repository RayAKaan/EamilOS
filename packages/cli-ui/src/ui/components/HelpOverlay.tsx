import React from 'react';
import { Box, Text } from 'ink';

interface HelpOverlayProps {
  onClose: () => void;
}

export const HelpOverlay: React.FC<HelpOverlayProps> = ({ onClose }) => {
  return (
    <Box flexDirection="column" padding={3}>
      <Text bold color="cyan">EamilOS Keyboard Shortcuts</Text>
      <Box>
        <Text>Navigation: </Text>
        <Text>d/1 Dashboard | r/2 Run Task | a/3 Agents | c/4 Config</Text>
      </Box>
      <Box>
        <Text>Task: </Text>
        <Text>Enter Run | Space Pause | x Stop | Esc Back</Text>
      </Box>
      <Box>
        <Text>System: </Text>
        <Text>h Help | p Palette | \ Sidebar | q Quit</Text>
      </Box>
      <Text dimColor>Press any key to close</Text>
    </Box>
  );
};

interface CommandPaletteProps {
  bridge: any;
  onClose: () => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({ onClose }) => {
  const commands = [
    { key: 'd', label: 'Go to Dashboard' },
    { key: 'r', label: 'Run New Task' },
    { key: 'a', label: 'View Agents' },
    { key: 'c', label: 'Open Config' },
    { key: '\\', label: 'Toggle Sidebar' },
    { key: 'h', label: 'Show Help' },
    { key: 'q', label: 'Quit EamilOS' },
  ];

  return (
    <Box flexDirection="column" padding={2} borderStyle="round" borderColor="cyan">
      <Text bold color="cyan">Command Palette</Text>
      {commands.map((cmd) => (
        <Box key={cmd.key}>
          <Text color="white">{cmd.label}</Text>
          <Text dimColor> ({cmd.key})</Text>
        </Box>
      ))}
      <Text dimColor>Esc to close</Text>
    </Box>
  );
};