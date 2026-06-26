import React from 'react';
import { Box, Text } from 'ink';

interface ProposedFileChange {
  type: 'create' | 'modify' | 'delete';
  filePath: string;
  estimatedTokens?: number;
}

interface Props {
  file: ProposedFileChange;
}

export const FileDiffBlock: React.FC<Props> = ({ file }) => {
  return (
    <Box flexDirection="column" marginY={0} paddingLeft={2}>
      <Box>
        <Text bold>{file.type === 'create' ? '+' : file.type === 'delete' ? '-' : '~'}</Text>
        <Text> </Text>
        <Text>{file.filePath}</Text>
        {file.estimatedTokens !== undefined && (
          <Text dimColor> ({file.estimatedTokens} tokens)</Text>
        )}
      </Box>
    </Box>
  );
};
