// model.ts — AppModel: single immutable-style state record for the entire TUI.

export type Page         = 'chat' | 'logs' | 'agents' | 'sessions' | 'terminals';
export type AgentMode    = 'communication' | 'execution';
export type Strategy     = 'single' | 'single-fallback' | 'fallback' | 'swarm' | 'manual';
export type DetectionState = 'idle' | 'detecting' | 'complete' | 'failed';

export interface AgentEntry {
  id:       string;
  name:     string;
  callsign: string;
  status:   'ready' | 'busy' | 'offline' | 'not_installed';
  version?: string;
  error?:   string;
}

export interface TerminalEntry {
  agentId:  string;
  callsign: string;
  pid?:     number;
  cwd:      string;
  status:   'spawning' | 'running' | 'done' | 'error';
  elapsed:  number;
  lastLine: string;
}

export type MsgType =
  | 'user'
  | 'agent'
  | 'system'
  | 'arbiter'
  | 'error'
  | 'run_summary';

export interface ToolCall {
  name:    string;
  args:    string;
  status:  'pending' | 'running' | 'done' | 'failed';
  result?: string;
  lines?:  number;
}

export interface Message {
  id:         string;
  type:       MsgType;
  agentId?:   string;
  callsign?:  string;
  content:    string;
  timestamp:  number;
  tools:      ToolCall[];
  streaming:  boolean;
  validated?: boolean;
}

export interface SessionEntry {
  id:           string;
  goal:         string;
  strategy:     Strategy;
  startedAt:    number;
  duration?:    number;
  messageCount: number;
  status:       'running' | 'completed' | 'failed';
}

export interface ModifiedFile {
  path:   string;
  action: 'create' | 'modify' | 'delete';
  agent:  string;
}

export interface RunSummary {
  strategy:   string;
  agentUsed:  string;
  durationMs: number;
  fileCount:  number;
  validated:  boolean;
  errors:     string[];
}

export interface AppModel {
  // Terminal geometry
  width:          number;
  height:         number;
  // Navigation
  page:           Page;
  // Execution settings
  mode:           AgentMode;
  strategy:       Strategy;
  running:        boolean;
  // Input
  input:          string;
  cursor:         number;
  lastPrompt:     string;
  scroll:         number;
  // Panels
  sidebarVisible: boolean;
  // Agent state
  detectionState: DetectionState;
  agents:         Map<string, AgentEntry>;
  terminals:      TerminalEntry[];
  // Content
  messages:       Message[];
  logs:           string[];
  sessions:       SessionEntry[];
  modifiedFiles:  ModifiedFile[];
  // Results
  runSummary:     RunSummary | null;
  // UI
  statusText:     string;
  spinFrame:      number;
  // Notification flash (empty = none)
  notification:   string;
}

export function initialModel(width: number, height: number): AppModel {
  return {
    width,
    height,
    page:           'chat',
    mode:           'communication',
    strategy:       'single-fallback',
    running:        false,
    input:          '',
    cursor:         0,
    lastPrompt:     '',
    scroll:         0,
    sidebarVisible: true,
    detectionState: 'idle',
    agents:         new Map(),
    terminals:      [],
    messages:       [],
    logs:           [],
    sessions:       [],
    modifiedFiles:  [],
    runSummary:     null,
    statusText:     '',
    spinFrame:      0,
    notification:   '',
  };
}

export function readyAgentCount(model: AppModel): number {
  let count = 0;
  for (const a of model.agents.values()) {
    if (a.status === 'ready') count++;
  }
  return count;
}

let _msgId = 0;
export function nextMsgId(): string { return `m${++_msgId}`; }
