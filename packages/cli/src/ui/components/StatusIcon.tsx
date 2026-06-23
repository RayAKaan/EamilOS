import React from 'react';
import { Text } from 'ink';
import type { GraphNodeStatus } from '../types/ui';

interface StatusIconProps {
  status: GraphNodeStatus;
  bold?: boolean;
}

const STATUS_CONFIG: Record<GraphNodeStatus, { icon: string; color: string }> = {
  done: { icon: '✓', color: 'green' },
  running: { icon: '⏳', color: 'cyan' },
  failed: { icon: '✗', color: 'red' },
  pending: { icon: '○', color: 'gray' },
  blocked: { icon: '?', color: 'yellow' },
};

export const StatusIcon: React.FC<StatusIconProps> = ({ status, bold }) => {
  const config = STATUS_CONFIG[status];
  return (
    <Text color={config.color as 'green' | 'cyan' | 'red' | 'gray' | 'yellow'} bold={bold}>
      {config.icon}
    </Text>
  );
};

export const getStatusColor = (status: GraphNodeStatus): string => {
  return STATUS_CONFIG[status].color;
};
