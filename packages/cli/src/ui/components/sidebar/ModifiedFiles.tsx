import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import { useStore } from '../../state/store.js';

export const ModifiedFiles: React.FC = () => {
  const messages = useStore((s) => s.messages);

  const files = useMemo(() => {
    const seen = new Set<string>();
    const result: { path: string; status: 'added' | 'modified' | 'deleted' }[] = [];
    for (const msg of messages) {
      if (msg.tools) {
        for (const tool of msg.tools) {
          if (tool.status === 'done' && tool.args && !seen.has(tool.args)) {
            seen.add(tool.args);
            const status: 'added' | 'modified' | 'deleted' =
              tool.name === 'created' ? 'added' :
              tool.name === 'deleted' ? 'deleted' : 'modified';
            result.push({ path: tool.args.slice(0, 40), status });
          }
        }
      }
    }
    return result;
  }, [messages]);

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
