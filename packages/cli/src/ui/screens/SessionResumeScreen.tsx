import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text } from 'ink';
import type { Session } from '../types/ui';
import { SessionItem } from '../components/SessionItem';
import { useStore } from '../state/store';

interface SessionResumeScreenProps {
  onResume: (sessionId: string) => void;
  onNew: () => void;
}

export const SessionResumeScreen: React.FC<SessionResumeScreenProps> = ({
  onResume,
  onNew,
}) => {
  const { recentSessions } = useStore();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [keyHandler, setKeyHandler] = useState<((input: string, key: { upArrow?: boolean; downArrow?: boolean; return?: boolean }) => void) | null>(null);

  useEffect(() => {
    setSessions(recentSessions as Session[]);
    setLoading(false);
  }, [recentSessions]);

  const handleKeyInput = useCallback((input: string, key: { upArrow?: boolean; downArrow?: boolean; return?: boolean }) => {
    if (loading) return;

    if (key.upArrow) {
      setSelectedIndex(i => Math.max(0, i - 1));
    }
    
    if (key.downArrow) {
      setSelectedIndex(i => Math.min(sessions.length, i + 1));
    }
    
    if (key.return) {
      if (selectedIndex < sessions.length) {
        onResume(sessions[selectedIndex].id);
      } else {
        onNew();
      }
    }
    
    if (input.toLowerCase() === 'n') {
      onNew();
    }
  }, [loading, sessions, selectedIndex, onResume, onNew]);

  useEffect(() => {
    setKeyHandler(() => handleKeyInput);
  }, [handleKeyInput]);

  if (loading) {
    return (
      <Box flexDirection="column" padding={2} alignItems="center">
        <Text dimColor>Loading sessions...</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" height="100%" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">Session Manager</Text>
      </Box>

      <Box flexDirection="column" flexGrow={1}>
        <Box padding={2} alignItems="center">
          <Text dimColor>Press N to start new session</Text>
        </Box>
      </Box>

      <Box marginTop={1} borderStyle="round" borderColor="gray" padding={1}>
        <Text dimColor>
          Up/Down Navigate  [Enter] New Session  [N] New
        </Text>
      </Box>
    </Box>
  );
};
