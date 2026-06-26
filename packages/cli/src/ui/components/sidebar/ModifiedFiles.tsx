import React from 'react';
import { Box, Text } from 'ink';

export const ModifiedFiles: React.FC = () => {
  const files: { path: string; status: 'added' | 'modified' | 'deleted' }[] = [];

  return (
    <Box flexDirection="column">
      <Text bold underline>Modified</Text>
      {files.length === 0 && <Text dimColor>no changes</Text>}
      {files.map((f, i) => (
        <Box key={i}>
          <Text color={
            f.status === 'added' ? 'green' :
            f.status === 'deleted' ? 'red' : 'yellow'
          }>
            {f.status === 'added' ? '+' : f.status === 'deleted' ? '-' : '~'}
          </Text>
          <Text> {f.path}</Text>
        </Box>
      ))}
    </Box>
  );
};
