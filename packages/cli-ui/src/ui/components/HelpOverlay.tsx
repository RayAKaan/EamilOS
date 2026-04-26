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
        <Text>d Dashboard | r Run Task | a Agents | c Config</Text>
      </Box>
      <Box>
        <Text>Tasks: </Text>
        <Text>F5 Run | F6 Pause | F7 Stop | Enter Select</Text>
      </Box>
      <Box>
        <Text>System: </Text>
        <Text>Ctrl+P Command Palette | ? Help | q Quit</Text>
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
  return (
    <Box flexDirection="column" padding={2}>
      <Text bold>Command Palette</Text>
      <Text>New Task (n)</Text>
      <Text>View Dashboard (d)</Text>
      <Text>Quit (q)</Text>
      <Text dimColor>Esc to close</Text>
    </Box>
  );
};