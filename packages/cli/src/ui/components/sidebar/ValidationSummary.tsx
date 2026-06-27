import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import { useStore } from '../../state/store.js';

export const ValidationSummary: React.FC = () => {
  const logs = useStore((s) => s.logs);
  const graphStats = useStore((s) => s.graphStats);

  const errors = useMemo(() => {
    return logs
      .filter((l) => l.startsWith('VALIDATION:') || l.startsWith('PERMISSION:') || l.startsWith('ERROR:'))
      .slice(-5);
  }, [logs]);

  const validated = graphStats.validated;

  return (
    <Box flexDirection="column">
      <Text bold underline>Validation</Text>
      {errors.length === 0 && validated === undefined && <Text dimColor>waiting</Text>}
      {errors.length === 0 && validated === true && <Text color="green">passing</Text>}
      {errors.length === 0 && validated === false && <Text color="red">failed</Text>}
      {errors.map((e, i) => (
        <Text key={i} color="red" wrap="truncate-end">{e.slice(0, 28)}</Text>
      ))}
    </Box>
  );
};
