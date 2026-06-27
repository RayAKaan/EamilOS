export type DetectionState = 'idle' | 'detecting' | 'complete' | 'failed';

export type PageId = 'chat' | 'logs' | 'agents' | 'sessions' | 'terminals';

export type StrategyId = 'single' | 'single-fallback' | 'fallback' | 'swarm' | 'manual';

export interface AgentUiInfo {
  id: string;
  name: string;
  status: 'available' | 'busy' | 'offline' | 'failed';
  kind: string;
  provider: string;
  version?: string;
  error?: string;
}

export interface TuiMessage {
  id: string;
  timestamp: number;
  agentId?: string;
  content: string;
  isStreaming: boolean;
  isUser: boolean;
  isSystem: boolean;
  isError: boolean;
}

export interface LogEntry {
  timestamp: number;
  level: string;
  message: string;
}

export interface TerminalInfo {
  callsign: string;
  agentId: string;
  status: 'ready' | 'running' | 'done' | 'failed' | 'killed';
  mode: string;
  lastLine?: string;
}

export interface GraphStats {
  nodes: number;
  edges: number;
  validated: boolean;
}

export interface SessionSummary {
  id: string;
  goal: string;
  strategy: StrategyId;
  startedAt: number;
  status: 'active' | 'completed' | 'failed';
  messageCount: number;
}

export interface ModifiedFile {
  path: string;
  action: 'create' | 'modify' | 'delete';
  status: 'pending' | 'applied' | 'failed';
  agentId?: string;
}

export interface TuiState {
  detectionState: DetectionState;
  agents: AgentUiInfo[];
  messages: TuiMessage[];
  logs: LogEntry[];
  terminals: TerminalInfo[];
  graph: GraphStats;
  modifiedFiles: ModifiedFile[];
  sessions: SessionSummary[];
  inputValue: string;
  activePage: PageId;
  strategy: StrategyId;
  isRunning: boolean;
  sidebarVisible: boolean;
  statusMessage: string;
  terminalWidth: number;
  terminalHeight: number;
  errorCount: number;
  warnCount: number;
}
