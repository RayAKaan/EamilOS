import { create } from 'zustand';
import type {
  ExecutionNode,
  Session,
  AgentQuestion,
  LogEntry,
} from '../types/ui.js';

interface ExecutionState {
  tree: ExecutionNode | null;
  currentNodeId: string | null;
  isRunning: boolean;
  attempt: number;
  maxAttempts: number;
  setTree: (tree: ExecutionNode) => void;
  updateNode: (nodeId: string, updates: Partial<ExecutionNode>) => void;
  addNode: (parentId: string | null, node: ExecutionNode) => void;
  setCurrentNode: (nodeId: string | null) => void;
  setRunning: (running: boolean) => void;
  incrementAttempt: () => void;
  resetExecution: () => void;
}

interface SessionState {
  currentSession: Session | null;
  recentSessions: Session[];
  autoSaveEnabled: boolean;
  lastSaved: number | null;
  setCurrentSession: (session: Session | null) => void;
  addRecentSession: (session: Session) => void;
  removeRecentSession: (sessionId: string) => void;
  updateSessionState: (updates: Partial<Session['state']>) => void;
  setAutoSave: (enabled: boolean) => void;
  setLastSaved: (timestamp: number) => void;
}

interface DialogueState {
  pendingQuestion: AgentQuestion | null;
  isBlocked: boolean;
  setPendingQuestion: (question: AgentQuestion | null) => void;
  setBlocked: (blocked: boolean) => void;
  answerQuestion: (answer: string) => void;
}

interface LogsState {
  logs: LogEntry[];
  maxLogs: number;
  addLog: (log: Omit<LogEntry, 'id' | 'timestamp'>) => void;
  clearLogs: () => void;
  setLogs: (logs: LogEntry[]) => void;
}

export type AppState = ExecutionState & SessionState & DialogueState & LogsState;

const updateNodeRecursive = (
  node: ExecutionNode,
  nodeId: string,
  updates: Partial<ExecutionNode>
): ExecutionNode => {
  if (node.id === nodeId) {
    return {
      ...node,
      ...updates,
      updatedAt: Date.now(),
      children: updates.children ?? node.children,
    };
  }
  return {
    ...node,
    children: node.children.map((child: ExecutionNode) => updateNodeRecursive(child, nodeId, updates)),
  };
};

const addNodeRecursive = (
  tree: ExecutionNode,
  parentId: string,
  node: ExecutionNode
): ExecutionNode => {
  if (tree.id === parentId) {
    return {
      ...tree,
      children: [...tree.children, node],
    };
  }
  return {
    ...tree,
    children: tree.children.map((child: ExecutionNode) => addNodeRecursive(child, parentId, node)),
  };
};

export const useStore = create<AppState>()((set, get) => ({
  tree: null,
  currentNodeId: null,
  isRunning: false,
  attempt: 1,
  maxAttempts: 3,

  setTree: (tree: ExecutionNode) => set({ tree }),

  updateNode: (nodeId: string, updates: Partial<ExecutionNode>) => {
    const tree = get().tree;
    if (!tree) return;
    set({ tree: updateNodeRecursive(tree, nodeId, updates) });
  },

  addNode: (parentId: string | null, node: ExecutionNode) => {
    const tree = get().tree;
    if (!tree) {
      set({ tree: node });
      return;
    }
    if (parentId === null) {
      set({ tree: node });
      return;
    }
    set({ tree: addNodeRecursive(tree, parentId, node) });
  },

  setCurrentNode: (nodeId: string | null) => set({ currentNodeId: nodeId }),
  setRunning: (running: boolean) => set({ isRunning: running }),
  incrementAttempt: () => set((state) => ({ attempt: state.attempt + 1 })),
  resetExecution: () => set({
    tree: null,
    currentNodeId: null,
    isRunning: false,
    attempt: 1,
  }),

  currentSession: null,
  recentSessions: [],
  autoSaveEnabled: true,
  lastSaved: null,

  setCurrentSession: (session: Session | null) => set({ currentSession: session }),

  addRecentSession: (session: Session) => set((state) => ({
    recentSessions: [
      session,
      ...state.recentSessions.filter((s) => s.id !== session.id)
    ].slice(0, 10),
  })),

  removeRecentSession: (sessionId: string) => set((state) => ({
    recentSessions: state.recentSessions.filter((s) => s.id !== sessionId),
  })),

  updateSessionState: (updates: Partial<Session['state']>) => {
    const state = get();
    if (!state.currentSession) return;
    set({
      currentSession: {
        ...state.currentSession,
        state: { ...state.currentSession.state, ...updates },
        lastUpdated: Date.now(),
      },
    });
  },

  setAutoSave: (enabled: boolean) => set({ autoSaveEnabled: enabled }),
  setLastSaved: (timestamp: number) => set({ lastSaved: timestamp }),

  pendingQuestion: null,
  isBlocked: false,

  setPendingQuestion: (question: AgentQuestion | null) => set({
    pendingQuestion: question,
    isBlocked: question !== null,
  }),

  setBlocked: (blocked: boolean) => set({ isBlocked: blocked }),

  answerQuestion: () => {
    set({ pendingQuestion: null, isBlocked: false });
  },

  logs: [],
  maxLogs: 100,

  addLog: (log: Omit<LogEntry, 'id' | 'timestamp'>) => set((state) => {
    const newLog: LogEntry = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      ...log,
    };
    return {
      logs: [...state.logs, newLog].slice(-state.maxLogs),
    };
  }),

  clearLogs: () => set({ logs: [] }),
  setLogs: (logs: LogEntry[]) => set({ logs }),
}));

export const useExecutionTree = () => useStore((state) => state.tree);
export const useCurrentSession = () => useStore((state) => state.currentSession);
export const usePendingQuestion = () => useStore((state) => state.pendingQuestion);
export const useLogs = () => useStore((state) => state.logs);
export const useIsBlocked = () => useStore((state) => state.isBlocked);
export const useCurrentNode = () => useStore((state) => state.currentNodeId);
export const useIsRunning = () => useStore((state) => state.isRunning);
export const useAttempt = () => useStore((state) => state.attempt);
