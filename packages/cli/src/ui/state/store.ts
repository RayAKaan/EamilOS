import { create } from 'zustand';
import { nanoid } from 'nanoid';
import type {
  AppState,
  Message,
  ToolCall,
  ExecutionStrategy,
  AgentInfo,
  GraphStats,
} from '../types/ui.js';

interface StoreActions {
  addMessage: (msg: Omit<Message, 'id' | 'timestamp'>) => string;
  updateMessage: (id: string, updates: Partial<Message>) => void;
  appendToMessage: (id: string, chunk: string) => void;
  addToolToMessage: (id: string, tool: Omit<ToolCall, 'id'>) => string;
  updateToolInMessage: (messageId: string, toolId: string, updates: Partial<ToolCall>) => void;
  setRunning: (running: boolean) => void;
  setStrategy: (strategy: ExecutionStrategy) => void;
  setAgentStatus: (agent: 'opencode' | 'gemini', info: Partial<AgentInfo>) => void;
  updateGraphStats: (stats: Partial<GraphStats>) => void;
  setLastPrompt: (prompt: string) => void;
  toggleGraphPanel: () => void;
  clearMessages: () => void;
  setExecutionStart: () => void;
  setTerminalSize: (width: number, height: number) => void;
}

const defaultGraphStats: GraphStats = {
  nodes: 0,
  edges: 0,
  strategy: 'opencode-first',
};

const defaultAgentInfo: AgentInfo = { status: 'offline', version: 'Kernel' };

export const useStore = create<AppState & StoreActions>((set) => ({
  messages: [],
  isRunning: false,
  currentStrategy: 'opencode-first' as ExecutionStrategy,
  graphStats: defaultGraphStats,
  agentStatus: {
    opencode: { ...defaultAgentInfo },
    gemini: { ...defaultAgentInfo },
  },
  lastPrompt: '',
  showGraphPanel: false,
  executionStart: undefined,
  terminalWidth: process.stdout.columns ?? 120,
  terminalHeight: process.stdout.rows ?? 30,

  addMessage: (msg) => {
    const id = nanoid();
    const message: Message = { id, timestamp: Date.now(), ...msg };
    set((s) => ({ messages: [...s.messages, message] }));
    return id;
  },

  updateMessage: (id, updates) => {
    set((s) => ({
      messages: s.messages.map((m) => (m.id === id ? { ...m, ...updates } : m)),
    }));
  },

  appendToMessage: (id, chunk) => {
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === id ? { ...m, content: m.content + chunk } : m
      ),
    }));
  },

  addToolToMessage: (messageId, tool) => {
    const toolId = nanoid();
    const newTool: ToolCall = { id: toolId, ...tool };
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === messageId
          ? { ...m, tools: [...(m.tools ?? []), newTool] }
          : m
      ),
    }));
    return toolId;
  },

  updateToolInMessage: (messageId, toolId, updates) => {
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === messageId
          ? {
              ...m,
              tools: (m.tools ?? []).map((t) =>
                t.id === toolId ? { ...t, ...updates } : t
              ),
            }
          : m
      ),
    }));
  },

  setRunning: (running) => set({ isRunning: running }),

  setStrategy: (strategy) =>
    set((s) => ({
      currentStrategy: strategy,
      graphStats: { ...s.graphStats, strategy },
    })),

  setAgentStatus: (agent, info) =>
    set((s) => ({
      agentStatus: {
        ...s.agentStatus,
        [agent]: { ...s.agentStatus[agent], ...info },
      },
    })),

  updateGraphStats: (stats) =>
    set((s) => ({ graphStats: { ...s.graphStats, ...stats } })),

  setLastPrompt: (prompt) => set({ lastPrompt: prompt }),
  toggleGraphPanel: () => set((s) => ({ showGraphPanel: !s.showGraphPanel })),
  clearMessages: () => set({ messages: [] }),
  setExecutionStart: () => set({ executionStart: Date.now() }),
  setTerminalSize: (width, height) => set({ terminalWidth: width, terminalHeight: height }),
}));
