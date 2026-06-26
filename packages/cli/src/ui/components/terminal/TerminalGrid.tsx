import React from 'react';
import { Box } from 'ink';
import { useStore } from '../../state/store.js';
import { TerminalPane } from './TerminalPane.js';

export const TerminalGrid: React.FC = () => {
  const terminals = useStore((s) => s.activeTerminals);

  if (terminals.length === 0) {
    return (
      <Box flexGrow={1} justifyContent="center" alignItems="center">
        <Box>No active terminals</Box>
      </Box>
    );
  }

  const cols = Math.min(terminals.length, 3);
  const rows = Math.ceil(terminals.length / cols);

  const grid: typeof terminals[] = [];
  for (let r = 0; r < rows; r++) {
    grid.push(terminals.slice(r * cols, (r + 1) * cols));
  }

  return (
    <Box flexDirection="column" flexGrow={1}>
      {grid.map((row, ri) => (
        <Box key={ri} flexDirection="row" flexGrow={1}>
          {row.map((t) => (
            <Box key={t.callsign} flexGrow={1} width={`${100 / cols}%`}>
              <TerminalPane terminal={t} />
            </Box>
          ))}
        </Box>
      ))}
    </Box>
  );
};
