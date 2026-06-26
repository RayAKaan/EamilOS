import React from 'react';
import { Box } from 'ink';
import { useStore } from '../../state/store.js';
import { PermissionDialog } from '../dialogs/PermissionDialog.js';
import { CommandPalette } from '../dialogs/CommandPalette.js';
import { AgentSelector } from '../dialogs/AgentSelector.js';
import { ModelSelector } from '../dialogs/ModelSelector.js';
import { HelpDialog } from '../dialogs/HelpDialog.js';
import { QuitDialog } from '../dialogs/QuitDialog.js';

export const DialogLayer: React.FC = () => {
  const overlay = useStore((s) => s.activeOverlay);

  if (!overlay) return null;

  const dialog: Record<string, React.ReactNode> = {
    permission: <PermissionDialog />,
    command_palette: <CommandPalette />,
    agent_selector: <AgentSelector />,
    model_selector: <ModelSelector />,
    help: <HelpDialog />,
    quit: <QuitDialog />,
  };

  return (
    <Box
      width="100%"
      height="100%"
      justifyContent="center"
      alignItems="center"
    >
      <Box
        borderStyle="single"
        borderColor="cyan"
        paddingX={2}
        paddingY={1}
        minWidth={40}
        width={80}
      >
        {dialog[overlay] ?? null}
      </Box>
    </Box>
  );
};
