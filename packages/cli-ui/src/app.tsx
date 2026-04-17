import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { ExecutionView } from './screens/ExecutionView';
import { SessionResumeScreen } from './screens/SessionResumeScreen';
import { useSessionPersistence } from './hooks/useSessionPersistence';
import { useAgentDialogue } from './hooks/useAgentDialogue';

const EAMILOS_VERSION = process.env.EAMILOS_VERSION || '1.0.0';

type AppScreen = 'resume' | 'execution';

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends React.Component<{children?: React.ReactNode}, ErrorBoundaryState> {
  constructor(props: {}) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error('UI Error:', error, errorInfo);
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <Box flexDirection="column" padding={2}>
          <Text color="red">UI Error</Text>
          <Text dimColor>{this.state.error?.message || 'Unknown error'}</Text>
          <Text dimColor>Press Ctrl+C to exit</Text>
        </Box>
      );
    }
    return this.props.children;
  }
}

export const App: React.FC = () => {
  const [screen, setScreen] = useState<AppScreen>('resume');
  const { createSession, resumeSession } = useSessionPersistence();
  const { hasPendingQuestion } = useAgentDialogue();

  useEffect(() => {
    setScreen('resume');
  }, []);

  const handleResume = async (sessionId: string) => {
    try {
      await resumeSession(sessionId);
      setScreen('execution');
    } catch (error) {
      console.error('Resume failed:', error);
    }
  };

  const handleNew = () => {
    createSession('New Task');
    setScreen('execution');
  };

  return (
    <ErrorBoundary>
      <Box flexDirection="column" height="100%">
        <Box paddingX={1} paddingY={0.5}>
          <Text bold color="cyan">EamilOS</Text>
          <Text dimColor> v{EAMILOS_VERSION}</Text>
          {hasPendingQuestion && (
            <Text color="yellow"> [Awaiting Input]</Text>
          )}
        </Box>

        <Box flexGrow={1}>
          {screen === 'resume' && (
            <SessionResumeScreen
              onResume={handleResume}
              onNew={handleNew}
            />
          )}
          
          {screen === 'execution' && (
            <ExecutionView />
          )}
        </Box>

        <Box 
          borderStyle="round" 
          borderColor="gray"
          paddingX={1}
          paddingY={0.5}
        >
          <Text dimColor>
            {screen === 'execution' 
              ? hasPendingQuestion 
                ? 'Execution Mode - Awaiting Input' 
                : 'Execution Mode' 
              : 'Session Manager'}
            {' | Ctrl+C Exit'}
          </Text>
        </Box>
      </Box>
    </ErrorBoundary>
  );
};
