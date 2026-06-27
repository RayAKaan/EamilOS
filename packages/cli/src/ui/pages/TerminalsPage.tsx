import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { useStore } from '../state/store.js';
import { getAdaptiveMultiplexer } from '../../terminal/AdaptiveMultiplexer.js';

const STATUS_ICON: Record<string, string> = {
  ready: '○',
  running: '●',
  done: '✓',
  failed: '✗',
  killed: '■',
};

export const TerminalsPage: React.FC = () => {
  const terminals = useStore((s) => s.activeTerminals);
  const updateTerminal = useStore((s) => s.updateTerminal);
  const removeTerminal = useStore((s) => s.removeTerminal);
  const [selected, setSelected] = useState(0);

  useInput((input, key) => {
    if (key.upArrow || input === 'k') {
      setSelected((s) => Math.max(0, s - 1));
      return;
    }

    if (key.downArrow || input === 'j') {
      setSelected((s) => Math.min(terminals.length - 1, s + 1));
      return;
    }

    const terminal = terminals[selected];
    if (!terminal) return;

    if (input.toLowerCase() === 'c') {
      getAdaptiveMultiplexer().switchMode(terminal.callsign, 'communication');
      updateTerminal(terminal.callsign, { mode: 'communication' });
      return;
    }

    if (input.toLowerCase() === 'e') {
      getAdaptiveMultiplexer().switchMode(terminal.callsign, 'execution');
      updateTerminal(terminal.callsign, { mode: 'execution' });
      return;
    }

    if (key.ctrl && input === 'k') {
      getAdaptiveMultiplexer().terminateAgent(terminal.callsign);
      updateTerminal(terminal.callsign, { status: 'killed', endedAt: Date.now() });
      return;
    }

    if (input.toLowerCase() === 'x') {
      getAdaptiveMultiplexer().terminateAgent(terminal.callsign);
      removeTerminal(terminal.callsign);
    }
  });

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Text bold underline>Terminals</Text>

      {terminals.length === 0 && (
        <Text dimColor>No active terminals. Swarm terminals appear here when multiplexing is available.</Text>
      )}

      {terminals.map((terminal, index) => {
        const selectedRow = index === selected;
        const status = terminal.status ?? 'ready';
        const elapsed = terminal.startedAt
          ? `${Math.floor(((terminal.endedAt ?? Date.now()) - terminal.startedAt) / 1000)}s`
          : '—';

        return (
          <Box key={terminal.callsign} flexDirection="column">
            <Box>
              <Text color={selectedRow ? 'cyan' : undefined}>{selectedRow ? '› ' : '  '}</Text>
              <Text color={status === 'running' ? 'green' : status === 'failed' ? 'red' : 'gray'}>
                {STATUS_ICON[status] ?? '○'}
              </Text>
              <Text> </Text>
              <Text bold>{terminal.callsign}</Text>
              <Text dimColor> · </Text>
              <Text>{terminal.agentId}</Text>
              <Text dimColor> [{terminal.mode}] </Text>
              <Text dimColor>{elapsed}</Text>
            </Box>

            {terminal.lastLine && (
              <Box paddingLeft={4}>
                <Text dimColor wrap="truncate-end">{terminal.lastLine}</Text>
              </Box>
            )}
          </Box>
        );
      })}

      <Box marginTop={1}>
        <Text dimColor>j/k move · C communication · E execution · Ctrl+K kill · X remove</Text>
      </Box>
    </Box>
  );
};
