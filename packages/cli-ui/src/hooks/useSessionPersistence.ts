import { useEffect, useCallback, useRef } from 'react';
import { useStore } from '../state/store';
import type { Session, SessionStatus } from '../types/ui';

const AUTO_SAVE_INTERVAL = 2000;
const MAX_LOGS_TO_SAVE = 100;

interface SessionRepository {
  saveSession(session: Session): void;
  getSession(id: string): Session | null;
  getRecentSessions(limit?: number): Session[];
  getActiveSessions(): Session[];
  deleteSession(id: string): void;
}

function createUuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

export const useSessionPersistence = () => {
  const {
    currentSession,
    setCurrentSession,
    updateSessionState,
    tree,
    logs,
    attempt,
    addRecentSession,
    autoSaveEnabled,
  } = useStore();

  const dirtyRef = useRef(false);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const getRepo = useCallback((): SessionRepository | null => {
    return null;
  }, []);

  const saveSession = useCallback((session: Session) => {
    const repo = getRepo();
    if (!repo) return;
    
    try {
      repo.saveSession(session);
      useStore.setState({ lastSaved: Date.now() } as Partial<ReturnType<typeof useStore.getState>>);
      dirtyRef.current = false;
    } catch (error) {
      console.error('Failed to save session:', error);
    }
  }, [getRepo]);

  const createSession = useCallback((goal: string, metadata: Session['metadata'] = {}): Session => {
    const now = Date.now();
    const newSession: Session = {
      id: createUuid(),
      goal,
      status: 'active',
      createdAt: now,
      lastUpdated: now,
      state: {
        executionTree: {
          id: createUuid(),
          label: goal,
          status: 'pending',
          children: [],
          timestamp: now,
        },
        logs: [],
        attempt: 1,
        budgetUsed: 0,
      },
      metadata,
    };

    setCurrentSession(newSession);
    addRecentSession(newSession);
    dirtyRef.current = true;
    saveSession(newSession);
    
    return newSession;
  }, [setCurrentSession, addRecentSession, saveSession]);

  const resumeSession = useCallback(async (sessionId: string): Promise<Session> => {
    const repo = getRepo();
    if (!repo) throw new Error('Repository not available');
    
    try {
      const session = repo.getSession(sessionId);
      if (!session) throw new Error('Session not found');

      const repairedSession = repairSession(session);
      repairedSession.status = 'active';
      repairedSession.lastUpdated = Date.now();
      
      setCurrentSession(repairedSession);
      saveSession(repairedSession);
      
      return repairedSession;
    } catch (error) {
      try {
        repo.deleteSession(sessionId);
      } catch {}
      throw error;
    }
  }, [getRepo, setCurrentSession, saveSession]);

  const deleteSession = useCallback((sessionId: string) => {
    const repo = getRepo();
    if (!repo) return;
    
    try {
      repo.deleteSession(sessionId);
      useStore.getState().removeRecentSession(sessionId);
    } catch (error) {
      console.error('Failed to delete session:', error);
    }
  }, [getRepo]);

  const completeSession = useCallback((status: SessionStatus) => {
    if (!currentSession) return;
    
    const updated: Session = {
      ...currentSession,
      status,
      lastUpdated: Date.now(),
    };
    
    setCurrentSession(updated);
    saveSession(updated);
  }, [currentSession, setCurrentSession, saveSession]);

  useEffect(() => {
    if (!autoSaveEnabled || !currentSession) return;

    dirtyRef.current = true;

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(() => {
      if (dirtyRef.current && currentSession) {
        const sessionToSave: Session = {
          ...currentSession,
          state: {
            executionTree: tree || currentSession.state.executionTree,
            logs: logs.slice(-MAX_LOGS_TO_SAVE),
            attempt,
            budgetUsed: currentSession.state.budgetUsed,
          },
          lastUpdated: Date.now(),
        };
        
        saveSession(sessionToSave);
      }
    }, AUTO_SAVE_INTERVAL);

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [tree, logs, attempt, currentSession, autoSaveEnabled, saveSession]);

  useEffect(() => {
    return () => {
      if (dirtyRef.current && currentSession) {
        try {
          const sessionToSave: Session = {
            ...currentSession,
            state: {
              executionTree: tree || currentSession.state.executionTree,
              logs: logs.slice(-MAX_LOGS_TO_SAVE),
              attempt,
              budgetUsed: currentSession.state.budgetUsed,
            },
            lastUpdated: Date.now(),
          };
          
          const repo = getRepo();
          if (repo) repo.saveSession(sessionToSave);
        } catch {}
      }
    };
  }, [currentSession, tree, logs, attempt, getRepo]);

  return {
    createSession,
    resumeSession,
    deleteSession,
    completeSession,
    saveSession: () => currentSession && saveSession(currentSession),
  };
};

function repairSession(session: Session): Session {
  try {
    if (!session.state?.executionTree) {
      session.state = session.state || {} as Session['state'];
      session.state.executionTree = {
        id: createUuid(),
        label: session.goal,
        status: 'pending',
        children: [],
        timestamp: session.createdAt,
      };
    }

    if (!Array.isArray(session.state.logs)) {
      session.state.logs = [];
    }

    if (typeof session.state.attempt !== 'number') {
      session.state.attempt = 1;
    }

    if (typeof session.state.budgetUsed !== 'number') {
      session.state.budgetUsed = 0;
    }

    return session;
  } catch {
    return {
      ...session,
      state: {
        executionTree: {
          id: createUuid(),
          label: session.goal,
          status: 'pending',
          children: [],
          timestamp: Date.now(),
        },
        logs: [],
        attempt: 1,
        budgetUsed: 0,
      },
    };
  }
}
