import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text } from 'ink';
import type { Session } from '../types/ui';
import { SessionItem } from '../components/SessionItem';

interface SessionRepository {
  getRecentSessions(limit?: number): Session[];
  deleteSession(id: string): void;
}

interface SessionResumeScreenProps {
  onResume: (sessionId: string) => void;
  onNew: () => void;
}

export const SessionResumeScreen: React.FC<SessionResumeScreenProps> = ({
  onResume,
  onNew,
}) => {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [keyHandler, setKeyHandler] = useState<((input: string, key: { upArrow?: boolean; downArrow?: boolean; return?: boolean }) => void) | null>(null);

  useEffect(() => {
    try {
      const { getSessionRepository } = require('../../core/dist/db/index.js');
      const repo: SessionRepository = getSessionRepository();
      const recent = repo.getRecentSessions(10);
      setSessions(recent);
      setLoading(false);
    } catch (err) {
      setError('Failed to load sessions');
      setLoading(false);
    }
  }, []);

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
    
    if (input.toLowerCase() === 'd') {
      if (selectedIndex < sessions.length) {
        const session = sessions[selectedIndex];
        try {
          const { getSessionRepository } = require('../../core/dist/db/index.js');
          getSessionRepository().deleteSession(session.id);
          setSessions(prev => prev.filter(s => s.id !== session.id));
          setSelectedIndex(i => Math.max(0, i - 1));
        } catch {}
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

  if (error) {
    return (
      <Box flexDirection="column" padding={2}>
        <Text color="red">Error: {error}</Text>
        <Text dimColor>Press N to start new session</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" height="100%" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">Resume Session</Text>
      </Box>

      <Box flexDirection="column" flexGrow={1}>
        {sessions.length === 0 ? (
          <Box padding={2} alignItems="center">
            <Text dimColor>No recent sessions</Text>
            <Text dimColor>Press N to start new session</Text>
          </Box>
        ) : (
          sessions.map((session, index) => (
            <SessionItem
              key={session.id}
              session={session}
              focused={index === selectedIndex}
              onPress={() => onResume(session.id)}
              onDelete={() => {
                try {
                  const { getSessionRepository } = require('../../core/dist/db/index.js');
                  getSessionRepository().deleteSession(session.id);
                  setSessions(prev => prev.filter(s => s.id !== session.id));
                } catch {}
              }}
            />
          ))
        )}

        <Box 
          marginTop={1}
          paddingX={1}
          paddingY={0.5}
          borderStyle={selectedIndex === sessions.length ? 'round' : undefined}
          borderColor={selectedIndex === sessions.length ? 'cyan' : undefined}
        >
          <Text color={selectedIndex === sessions.length ? 'cyan' : 'gray'}>
            {selectedIndex === sessions.length ? '>' : ' '} + New Session
          </Text>
        </Box>
      </Box>

      <Box marginTop={1} borderStyle="round" borderColor="gray" padding={1}>
        <Text dimColor>
          Up/Down Navigate  [Enter] Select  [D] Delete  [N] New
        </Text>
      </Box>
    </Box>
  );
};
