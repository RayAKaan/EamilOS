import type { AgentEvent } from './events/agent-event.js';
import type { MissionDataState } from './mission-data.js';
import { initialMissionData } from './mission-data.js';
import type { FleetState } from './fleet-data.js';
import { initialFleetState } from './fleet-data.js';
import type { GraphState } from './graph-data.js';
import { initialGraphState } from './graph-data.js';
import type { LoopState } from './loop-data.js';
import { initialLoopState } from './loop-data.js';
import type { DecisionState } from './decision-data.js';
import { initialDecisionState } from './decision-data.js';
import type { ApprovalState } from './approval-data.js';
import { initialApprovalState } from './approval-data.js';
import type { CommandPaletteState } from './commands/types.js';
import { initialCommandPalette } from './commands/types.js';

export type Page = 'mission' | 'execution' | 'tasks' | 'artifacts' | 'sessions' | 'github' | 'fleet' | 'graph' | 'loop' | 'decisions' | 'approvals' | 'chat' | 'logs' | 'agents';
export type AgentMode = 'communication' | 'execution';
export type Strategy = 'single' | 'single-fallback' | 'fallback' | 'swarm' | 'manual';
export type DetectionState = 'idle' | 'detecting' | 'complete' | 'failed';
export type MissionStatus = 'draft' | 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
export type MissionValidation = 'idle' | 'running' | 'passed' | 'failed';

export interface MissionActivityItem {
  id: string;
  timestamp: number;
  title: string;
  detail?: string;
  severity: 'info' | 'success' | 'warning' | 'error';
  source?: string;
}

export interface MissionUiState {
  id: string;
  title: string;
  objective: string;
  status: MissionStatus;
  progress: number;
  currentAction: string;
  validation: MissionValidation;
  pendingApprovals: number;
  cost: string | null;
  deviceCount: number | null;
  startedAt?: number;
  activity: MissionActivityItem[];
}

export interface AgentEntry {
  id: string;
  name: string;
  callsign: string;
  status: 'ready' | 'busy' | 'offline' | 'not_installed';
  version?: string;
  error?: string;
}

export interface TerminalEntry {
  agentId: string;
  callsign: string;
  pid?: number;
  cwd: string;
  status: 'spawning' | 'running' | 'done' | 'error';
  elapsed: number;
  lastLine: string;
}

export type MsgType = 'user' | 'agent' | 'system' | 'arbiter' | 'error' | 'run_summary';

export interface ToolCall {
  name: string;
  args: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  result?: string;
  lines?: number;
}

export interface Message {
  id: string;
  type: MsgType;
  agentId?: string;
  callsign?: string;
  content: string;
  timestamp: number;
  tools: ToolCall[];
  streaming: boolean;
  validated?: boolean;
}

export interface SessionEntry {
  id: string;
  goal: string;
  strategy: Strategy;
  startedAt: number;
  duration?: number;
  messageCount: number;
  status: 'running' | 'completed' | 'failed';
}

export interface ModifiedFile {
  path: string;
  action: 'create' | 'modify' | 'delete';
  agent: string;
}

export interface RunSummary {
  strategy: string;
  agentUsed: string;
  durationMs: number;
  fileCount: number;
  validated: boolean;
  errors: string[];
}

export interface AppModel {
  width: number;
  height: number;
  page: Page;
  mode: AgentMode;
  strategy: Strategy;
  running: boolean;
  input: string;
  cursor: number;
  lastPrompt: string;
  scroll: number;
  sidebarVisible: boolean;
  detectionState: DetectionState;
  agents: Map<string, AgentEntry>;
  terminals: TerminalEntry[];
  messages: Message[];
  logs: string[];
  sessions: SessionEntry[];
  modifiedFiles: ModifiedFile[];
  runSummary: RunSummary | null;
  statusText: string;
  spinFrame: number;
  notification: string;
  missionUi: MissionUiState;
  agentEvents: AgentEvent[];
  activityFollow: boolean;
  activityScroll: number;
  missionData: MissionDataState;
  fleet: FleetState;
  graph: GraphState;
  loop: LoopState;
  decisions: DecisionState;
  approvals: ApprovalState;
  commandPalette: CommandPaletteState;
}

export function initialMissionUi(): MissionUiState {
  return {
    id: '',
    title: 'No active mission',
    objective: '',
    status: 'draft',
    progress: 0,
    currentAction: 'Waiting for a mission.',
    validation: 'idle',
    pendingApprovals: 0,
    cost: null,
    deviceCount: null,
    activity: [],
  };
}

export function initialModel(width: number, height: number): AppModel {
  return {
    width,
    height,
    page: 'mission',
    mode: 'communication',
    strategy: 'single-fallback',
    running: false,
    input: '',
    cursor: 0,
    lastPrompt: '',
    scroll: 0,
    sidebarVisible: true,
    detectionState: 'idle',
    agents: new Map(),
    terminals: [],
    messages: [],
    logs: [],
    sessions: [],
    modifiedFiles: [],
    runSummary: null,
    statusText: '',
    spinFrame: 0,
    notification: '',
    missionUi: initialMissionUi(),
    agentEvents: [],
    activityFollow: true,
    activityScroll: 0,
    missionData: initialMissionData(),
    fleet: initialFleetState(),
    graph: initialGraphState(),
    loop: initialLoopState(),
    decisions: initialDecisionState(),
    approvals: initialApprovalState(),
    commandPalette: initialCommandPalette(),
  };
}

export function readyAgentCount(model: AppModel): number {
  let count = 0;
  for (const a of model.agents.values()) if (a.status === 'ready') count++;
  return count;
}

let _msgId = 0;
export function nextMsgId(): string { return 'm' + String(++_msgId); }

let _activityId = 0;
export function nextActivityId(): string { return 'activity-' + String(++_activityId); }
