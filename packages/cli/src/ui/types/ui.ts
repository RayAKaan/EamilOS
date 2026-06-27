export type AgentStatus = 'ready' | 'busy' | 'offline' | 'failed';
export type ExecutionStrategy = 'single' | 'single-fallback' | 'fallback' | 'swarm' | 'manual' | 'gemini-first' | 'opencode-first' | 'parallel';
export type AgentMode = 'communication' | 'execution';

export type MessageType =
  | 'user'
  | 'opencode'
  | 'gemini'
  | 'eamilos'
  | 'arbiter'
  | 'system'
  | 'thinking'
  | 'graph-stats'
  | 'error';

export type ToolStatus = 'pending' | 'running' | 'done' | 'failed';

export interface ToolCall {
  id: string;
  name: string;
  args: string;
  status: ToolStatus;
  result?: string;
  lines?: number;
}

export interface Message {
  id: string;
  type: MessageType;
  content: string;
  timestamp: number;
  tools?: ToolCall[];
  agent?: 'opencode' | 'gemini' | 'EamilOS';
  isStreaming?: boolean;
  eventLabel?: string;
}

export interface GraphStats {
  nodes: number;
  edges: number;
  strategy: ExecutionStrategy;
  duration?: number;
  toolsUsed?: number;
  validated?: boolean;
}

export interface AgentInfo {
  status: AgentStatus;
  version?: string;
  error?: string;

  /** UI metadata populated from AgentRegistry / CallsignRegistry */
  id?: string;
  name?: string;
  callsign?: string;
  kind?: 'cli' | 'api' | 'local' | 'plugin';
  provider?: string;
  mode?: AgentMode;
}

export interface TerminalInfo {
  callsign: string;
  agentId: string;
  mode: 'communication_only' | 'unrestricted_execution' | 'communication' | 'execution';
}

export interface PermissionRequest {
  id: string;
  agentId: string;
  action: string;
  details: string;
  timestamp: number;
}

export type PageId = 'chat' | 'logs' | 'sessions' | 'agents';

export type OverlayId =
  | 'permission'
  | 'command_palette'
  | 'agent_selector'
  | 'model_selector'
  | 'help'
  | 'quit';

export interface SessionSummary {
  id: string;
  goal: string;
  strategy: ExecutionStrategy;
  startedAt: number;
  messageCount: number;
  status: 'active' | 'completed' | 'failed';
}

export interface AppState {
  messages: Message[];
  isRunning: boolean;
  currentStrategy: ExecutionStrategy;
  currentMode: AgentMode;
  currentAgentFilter: 'auto' | 'local' | 'cloud' | 'cli';
  graphStats: GraphStats;
  agentStatus: Record<string, AgentInfo>;
  pendingPermissions: PermissionRequest[];
  activeTerminals: TerminalInfo[];
  lastPrompt: string;
  showGraphPanel: boolean;
  executionStart?: number;
  terminalWidth: number;
  terminalHeight: number;
  activePage: PageId;
  activeOverlay: OverlayId | null;
  overlayParams: Record<string, unknown>;
  sidebarVisible: boolean;
  sidebarWidth: number;
  chatScrollY: number;
  chatInputValue: string;
  isInputFocused: boolean;
  logs: string[];
  sessions: SessionSummary[];
}
