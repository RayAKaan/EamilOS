import React from 'react';
import { Box, Text } from 'ink';
import chalk from 'chalk';

interface CostDashboardProps {
  snapshot: {
    cost: {
      timestamp: number;
      totalCost: number;
      agentCosts: Map<string, number>;
      modelCosts: Map<string, number>;
      tickCosts: number[];
    } | null;
    budget: {
      exceeded: boolean;
      warning: boolean;
      totalSpent: number;
      budgetLimit: number;
      percentageUsed: number;
      taskSpent: number;
      taskLimit: number;
    } | null;
  } | null;
}

export const CostDashboard: React.FC<CostDashboardProps> = ({ snapshot }) => {
  if (!snapshot || !snapshot.budget) {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="gray" padding={1}>
        <Text bold color="magenta">Cost Dashboard</Text>
        <Text dimColor>No cost data available</Text>
      </Box>
    );
  }

  const { budget } = snapshot;
  const costData = snapshot.cost;

  const percentage = budget.budgetLimit > 0 ? (budget.totalSpent / budget.budgetLimit) * 100 : 0;
  const warningColor = budget.exceeded ? 'red' : budget.warning ? 'yellow' : 'green';
  const barWidth = 30;
  const filledWidth = Math.min(barWidth, Math.round((percentage / 100) * barWidth));
  const emptyWidth = barWidth - filledWidth;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={warningColor} padding={1}>
      <Text bold color="magenta">Cost Dashboard</Text>

      <Box marginTop={1} flexDirection="row" gap={1}>
        <Text>
          <Text bold color={warningColor}>$</Text>
          <Text bold color={warningColor}>{budget.totalSpent.toFixed(4)}</Text>
          <Text dimColor> / ${budget.budgetLimit.toFixed(2)}</Text>
        </Text>
        <Text dimColor>({percentage.toFixed(1)}%)</Text>
      </Box>

      <Box marginTop={1}>
        <Text color={warningColor}>{'█'.repeat(filledWidth)}</Text>
        <Text dimColor>{'░'.repeat(emptyWidth)}</Text>
      </Box>

      {budget.exceeded && (
        <Box marginTop={1}>
          <Text bold color="red">⚠ Budget exceeded! Stop or increase limit.</Text>
        </Box>
      )}

      {budget.warning && !budget.exceeded && (
        <Box marginTop={1}>
          <Text bold color="yellow">⚠ Approaching budget limit</Text>
        </Box>
      )}

      {costData && costData.agentCosts.size > 0 && (
        <Box marginTop={1} flexDirection="column">
          <Text bold color="cyan">Agent Breakdown:</Text>
          {Array.from(costData.agentCosts.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([agentId, cost]) => (
              <Box key={agentId} flexDirection="row" gap={1}>
                <Text dimColor>{agentId.padEnd(25)}</Text>
                <Text color="yellow">${cost.toFixed(4)}</Text>
              </Box>
            ))}
        </Box>
      )}

      {costData && costData.modelCosts.size > 0 && (
        <Box marginTop={1} flexDirection="column">
          <Text bold color="cyan">Model Breakdown:</Text>
          {Array.from(costData.modelCosts.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([modelId, cost]) => (
              <Box key={modelId} flexDirection="row" gap={1}>
                <Text dimColor>{modelId.padEnd(25)}</Text>
                <Text color="yellow">${cost.toFixed(4)}</Text>
              </Box>
            ))}
        </Box>
      )}

      {costData && costData.tickCosts.length > 0 && (
        <Box marginTop={1}>
          <Text dimColor>
            Total API calls: {costData.tickCosts.length}
          </Text>
        </Box>
      )}
    </Box>
  );
};

export const MetricsStrip: React.FC<{
  budget?: { totalSpent: number; percentageUsed: number };
  isRunning?: boolean;
  uptime?: number;
  heapUsedMB?: number;
}> = ({ budget, isRunning, uptime, heapUsedMB }) => {
  const budgetColor = budget && budget.percentageUsed > 90 ? 'red' : budget && budget.percentageUsed > 70 ? 'yellow' : 'green';

  return (
    <Box flexDirection="row" gap={4}>
      {isRunning && (
        <Text>
          <Text color="cyan">*</Text> Running
        </Text>
      )}
      {uptime !== undefined && (
        <Text>
          <Text color="green">^</Text> {Math.floor(uptime / 60)}m {uptime % 60}s
        </Text>
      )}
      {heapUsedMB !== undefined && (
        <Text>
          <Text color="yellow">+</Text> {heapUsedMB}MB
        </Text>
      )}
      {budget && (
        <Text>
          <Text color={budgetColor}>$</Text> {budget.totalSpent.toFixed(4)}
          <Text dimColor> ({budget.percentageUsed.toFixed(0)}%)</Text>
        </Text>
      )}
    </Box>
  );
};
