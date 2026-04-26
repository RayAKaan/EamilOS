import React from 'react';
import { Box, Text } from 'ink';
import { useStore } from '../../../state/store';

export const Sidebar = () => {
  const { sidebarCollapsed, nodes, agents } = useStore();

  if (sidebarCollapsed) {
    return (
      <Box width={3} borderStyle="single">
        <Box flexDirection="column" alignItems="center">
          <Text>🖧</Text>
          <Text>🤖</Text>
          <Text>⚡</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box width={40} borderStyle="round">
      <Box flexDirection="column">
        <Box borderStyle="single" borderBottom paddingX={1}>
          <NodeSection nodes={nodes} />
        </Box>
        
        <Box borderStyle="single" borderBottom paddingX={1}>
          <AgentSection agents={agents} />
        </Box>
        
        <QuickActions />
      </Box>
    </Box>
  );
};

const NodeSection = ({ nodes }: { nodes: any[] }) => (
  <Box flexDirection="column" paddingY={1}>
    <Text bold color="cyan">Nodes ({nodes.length})</Text>
    {nodes.length === 0 ? (
      <Text dimColor>No nodes connected</Text>
    ) : (
      nodes.map((node: any) => (
        <Box key={node.id}>
          <Text>{node.status === 'connected' ? '🟢' : '🟡'} {node.id || node.name}</Text>
        </Box>
      ))
    )}
  </Box>
);

const AgentSection = ({ agents }: { agents: any[] }) => (
  <Box flexDirection="column" paddingY={1}>
    <Text bold color="cyan">Agents ({agents.length})</Text>
    {agents.length === 0 ? (
      <Text dimColor>No agents running</Text>
    ) : (
      agents.map((agent: any) => (
        <Box key={agent.id}>
          <Text>🤖 {agent.name}</Text>
        </Box>
      ))
    )}
  </Box>
);

const QuickActions = () => (
  <Box flexDirection="column" paddingX={1} paddingY={1}>
    <Text bold color="cyan">Actions</Text>
    <Text dimColor>n: New Task</Text>
    <Text dimColor>s: Save</Text>
  </Box>
);