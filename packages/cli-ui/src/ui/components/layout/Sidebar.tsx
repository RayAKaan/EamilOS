import React from 'react';
import { Box, Text } from 'ink';
import { useStore } from '../../../state/store';
import { useKeyboard } from '../../../hooks/useKeyboard';

export const Sidebar = () => {
  const { sidebarCollapsed, toggleSidebar, nodes, agents } = useStore();

  useKeyboard((keyId) => {
    if (keyId.toLowerCase() === '\\') {
      toggleSidebar();
    }
  });

  if (sidebarCollapsed) {
    return (
      <Box width={3}>
        <Box flexDirection="column" alignItems="center">
          <Text>🖧</Text>
          <Text>🤖</Text>
          <Text>⚡</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box width={40}>
      <Box flexDirection="column">
        <NodeSection nodes={nodes} />
        <AgentSection agents={agents} />
        <QuickActions />
      </Box>
    </Box>
  );
};

const NodeSection = ({ nodes }: { nodes: any[] }) => (
  <Box flexDirection="column" paddingX={1}>
    <Text bold underline>Nodes ({nodes.length})</Text>
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
  <Box flexDirection="column" paddingX={1}>
    <Text bold underline>Agents ({agents.length})</Text>
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
  <Box flexDirection="column" paddingX={1}>
    <Text bold underline>Actions</Text>
    <Text dimColor>n: New Task</Text>
    <Text dimColor>s: Save</Text>
  </Box>
);