import React from 'react';
import { Box } from 'ink';
import { useStore } from '../../state/store.js';
import { AgentRoster } from './AgentRoster.js';
import { ModifiedFiles } from './ModifiedFiles.js';
import { ValidationSummary } from './ValidationSummary.js';
import { BudgetSummary } from './BudgetSummary.js';

export const Sidebar: React.FC = () => {
  const visible = useStore((s) => s.sidebarVisible);
  const width = useStore((s) => s.sidebarWidth);

  if (!visible) return null;

  return (
    <Box
      width={width}
      flexDirection="column"
      borderStyle="single"
      borderColor="gray"
      paddingX={1}
    >
      <AgentRoster />
      <Box height={1} />
      <ModifiedFiles />
      <Box height={1} />
      <ValidationSummary />
      <Box height={1} />
      <BudgetSummary />
    </Box>
  );
};
