import { create } from 'zustand';
import { nanoid } from 'nanoid';
import type {
  AppState,
  Message,
  ToolCall,
  ExecutionStrategy,
  AgentMode,
  AgentInfo,
  GraphStats,
  TerminalInfo,
  PermissionRequest,
  PageId,
  OverlayId,
  SessionSummary,
} from '../types/ui.js';

interface StoreActions {
  addMessage: (msg: Omit<Message, 'id' | 'timestamp'>) => string;
  updateMessage: (id: string, updates: Partial<Message>) => void;
  appendToMessage: (id: string, chunk: string) => void;
  addToolToMessage: (id: string, tool: Omit<ToolCall, 'id'>) => string;
  updateToolInMessage: (messageId: string, toolId: string, updates: Partial<ToolCall>) => void;
  setRunning: (running: boolean) => void;
  setStrategy: (strategy: ExecutionStrategy) => void;
  setMode: (mode: AgentMode) => void;
  setAgentFilter: (filter: 'auto' | 'local' | 'cloud' | 'cli') => void;
  setAgentStatus: (agent: string, info: Partial<AgentInfo>) => void;
  updateGraphStats: (stats: Partial<GraphStats>) => void;
  setLastPrompt: (prompt: string) => void;
  toggleGraphPanel: () => void;
  clearMessages: () => void;
  setExecutionStart: () => void;
  setTerminalSize: (width: number, height: number) => void;
  setActiveTerminals: (terminals: TerminalInfo[]) => void;
  addTerminal: (terminal: TerminalInfo) => void;
  addPermissionRequest: (req: Omit<PermissionRequest, 'id' | 'timestamp'>) => string;
  resolvePermissionRequest: (id: string, approved: boolean) => void;
  setActivePage: (page: PageId) => void;
  openOverlay: (overlay: OverlayId, params?: Record<string, unknown>) => void;
  closeOverlay: () => void;
  setSidebarVisible: (visible: boolean) => void;
  setSidebarWidth: (width: number) => void;
  setChatScrollY: (y: number) => void;
  setChatInputValue: (value: string) => void;
  setInputFocused: (focused: boolean) => void;
  addLog: (entry: string) => void;
  clearLogs: () => void;
  setSessions: (sessions: SessionSummary[]) => void;
  addSession: (session: SessionSummary) => void;
  updateSession: (id: string, updates: Partial<SessionSummary>) => void;
}

const defaultGraphStats: GraphStats = {
  nodes: 0,
  edges: 0,
  strategy: 'single-fallback',
};

export const useStore = create<AppState & StoreActions>((set) => ({
  messages: [],
  isRunning: false,
  currentStrategy: 'single-fallback' as ExecutionStrategy,
  currentMode: 'communication' as AgentMode,
  currentAgentFilter: 'auto',
  graphStats: defaultGraphStats,
  agentStatus: {},
  pendingPermissions: [],
  lastPrompt: '',
  showGraphPanel: false,
  activeTerminals: [],
  executionStart: undefined,
  terminalWidth: process.stdout.columns ?? 120,
  terminalHeight: process.stdout.rows ?? 30,
  activePage: 'chat',
  activeOverlay: null,
  overlayParams: {},
  sidebarVisible: true,
  sidebarWidth: 28,
  chatScrollY: 0,
  chatInputValue: '',
  isInputFocused: false,
  logs: [],
  sessions: [],

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

  setMode: (mode) => set({ currentMode: mode }),

  setAgentFilter: (filter) => set({ currentAgentFilter: filter }),

  setAgentStatus: (agent, info) =>
    set((s) => ({
      agentStatus: {
        ...s.agentStatus,
        [agent]: { ...(s.agentStatus[agent] || { status: 'offline' }), ...info },
      },
    })),

  updateGraphStats: (stats) =>
    set((s) => ({ graphStats: { ...s.graphStats, ...stats } })),

  setLastPrompt: (prompt) => set({ lastPrompt: prompt }),
  toggleGraphPanel: () => set((s) => ({ showGraphPanel: !s.showGraphPanel })),
  clearMessages: () => set({ messages: [] }),
  setExecutionStart: () => set({ executionStart: Date.now() }),
  setTerminalSize: (width, height) => set({ terminalWidth: width, terminalHeight: height }),
  setActiveTerminals: (terminals) => set({ activeTerminals: terminals }),
  addTerminal: (terminal) =>
    set((s) => {
      const exists = s.activeTerminals.find(t => t.callsign === terminal.callsign);
      if (exists) return s;
      return { activeTerminals: [...s.activeTerminals, terminal] };
    }),

  addPermissionRequest: (req) => {
    const id = nanoid();
    const request: PermissionRequest = { id, timestamp: Date.now(), ...req };
    set((s) => ({ pendingPermissions: [...s.pendingPermissions, request] }));
    return id;
  },

  resolvePermissionRequest: (id, approved) =>
    set((s) => ({
      pendingPermissions: s.pendingPermissions.filter(p => p.id !== id),
    })),

  setActivePage: (page) => set({ activePage: page }),

  openOverlay: (overlay, params = {}) =>
    set({ activeOverlay: overlay, overlayParams: params }),

  closeOverlay: () => set({ activeOverlay: null, overlayParams: {} }),

  setSidebarVisible: (visible) => set({ sidebarVisible: visible }),

  setSidebarWidth: (width) => set({ sidebarWidth: width }),

  setChatScrollY: (y) => set({ chatScrollY: y }),

  setChatInputValue: (value) => set({ chatInputValue: value }),
  setInputFocused: (focused) => set({ isInputFocused: focused }),

  addLog: (entry) =>
    set((s) => ({ logs: [...s.logs, entry] })),

  clearLogs: () => set({ logs: [] }),

  setSessions: (sessions) => set({ sessions }),

  addSession: (session) =>
    set((s) => ({ sessions: [...s.sessions, session] })),

  updateSession: (id, updates) =>
    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id === id ? { ...sess, ...updates } : sess
      ),
    })),
}));
