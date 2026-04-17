import React from 'react';
import { Box, Text } from 'ink';
import type { ExecutionNode } from '../types/ui';
import { TreeNode } from './TreeNode';

interface ExecutionGraphProps {
  root: ExecutionNode | null;
  maxHeight?: number;
  showEmptyState?: boolean;
}

export const ExecutionGraph: React.FC<ExecutionGraphProps> = ({
  root,
  maxHeight = 25,
  showEmptyState = true,
}) => {
  if (!root) {
    if (!showEmptyState) return null;
    
    return (
      <Box 
        flexDirection="column" 
        borderStyle="round" 
        borderColor="gray"
        padding={1}
        height={maxHeight}
        justifyContent="center"
        alignItems="center"
      >
        <Text dimColor>○ No execution graph yet</Text>
        <Text dimColor>  Start a task to see the flow</Text>
      </Box>
    );
  }

  return (
    <Box 
      flexDirection="column" 
      borderStyle="round" 
      borderColor="cyan"
      paddingX={1}
      paddingY={0}
      height={maxHeight}
    >
      <Box paddingY={1}>
        <Text bold color="cyan">Execution Graph</Text>
      </Box>

      <Box flexGrow={1} overflow="hidden">
        <TreeNode
          node={root}
          depth={0}
          isLast={true}
          parentPrefix=""
        />
      </Box>

      <Box paddingY={1} flexDirection="row" gap={2}>
        <Text dimColor>Legend:</Text>
        <Text color="green">✓ Done</Text>
        <Text color="cyan">⏳ Run</Text>
        <Text color="red">✗ Fail</Text>
        <Text color="gray">○ Pend</Text>
        <Text color="yellow">? Ask</Text>
      </Box>
    </Box>
  );
};
