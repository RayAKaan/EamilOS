import React from 'react';
import { Box, Text } from 'ink';
import type { Session } from '../types/ui';
import { formatTimeAgo } from '../utils/time';

interface SessionItemProps {
  session: Session;
  focused: boolean;
  onPress: () => void;
  onDelete: () => void;
}

export const SessionItem: React.FC<SessionItemProps> = ({
  session,
  focused,
  onPress,
  onDelete,
}) => {
  const statusConfig: Record<Session['status'], { icon: string; color: string }> = {
    active: { icon: '⏳', color: 'cyan' },
    completed: { icon: '✓', color: 'green' },
    failed: { icon: '✗', color: 'red' },
    abandoned: { icon: '○', color: 'gray' },
  };

  const { icon, color } = statusConfig[session.status];

  return (
    <Box 
      flexDirection="column" 
      paddingX={1}
      paddingY={0.5}
      borderStyle={focused ? 'round' : undefined}
      borderColor={focused ? 'cyan' : undefined}
    >
      <Box>
        <Text color={focused ? 'cyan' : 'white'}>
          {focused ? '>' : ' '} {icon} {session.goal}
        </Text>
      </Box>
      
      <Box>
        <Text dimColor>
          {'  '}Updated {formatTimeAgo(session.lastUpdated)}
        </Text>
        <Text dimColor> | </Text>
        <Text dimColor>Attempt {session.state.attempt}</Text>
      </Box>
      
      {focused && (
        <Box marginTop={0.5}>
          <Text dimColor>
            {'  '}[Enter] Resume  [D] Delete
          </Text>
        </Box>
      )}
    </Box>
  );
};
