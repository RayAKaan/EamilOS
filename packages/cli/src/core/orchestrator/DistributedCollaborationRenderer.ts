import chalk from 'chalk';
import type { AgentRole } from '../collaboration/AgentType.js';
import { getAgentType } from '../collaboration/AgentType.js';
import type { ExecutionNode } from '../collaboration/ExecutionGraph.js';
import type { VectorClockSnapshot } from '../comms/VectorClock.js';
import type { DistributedAgentExecution } from './DistributedOrchestrator.js';
import type { DistributedOrchestrationResult, CollaborationLoop, CrossNodeTask } from './DistributedOrchestrator.js';
import type { MessageWithCausality } from '../comms/DistributedAgentCommunicator.js';

type ChalkFunction = (str: string | number) => string;

export type DistributedThinkingState =
  | 'idle'
  | 'planning'
  | 'analyzing'
  | 'researching'
  | 'coding'
  | 'validating'
  | 'reviewing'
  | 'writing'
  | 'executing'
  | 'waiting'
  | 'waiting-for-deps'
  | 'syncing'
  | 'collaborating'
  | 'completed'
  | 'failed'
  | 'timeout'
  | 'cancelled';

const STATE_COLORS: Record<DistributedThinkingState, ChalkFunction> = {
  idle: chalk.gray,
  planning: chalk.cyan,
  analyzing: chalk.blue,
  researching: chalk.magenta,
  coding: chalk.green,
  validating: chalk.yellow,
  reviewing: chalk.cyan,
  writing: chalk.blue,
  executing: chalk.green,
  waiting: chalk.gray,
  'waiting-for-deps': chalk.yellow,
  syncing: chalk.magenta,
  collaborating: chalk.cyan,
  completed: chalk.green,
  failed: chalk.red,
  timeout: chalk.red,
  cancelled: chalk.gray,
};

const STATE_ICONS: Record<DistributedThinkingState, string> = {
  idle: '○',
  planning: '◎',
  analyzing: '◉',
  researching: '◎',
  coding: '◈',
  validating: '◐',
  reviewing: '◑',
  writing: '◒',
  executing: '◓',
  waiting: '○',
  'waiting-for-deps': '⟳',
  syncing: '⚡',
  collaborating: '✦',
  completed: '●',
  failed: '✗',
  timeout: '⏱',
  cancelled: '○',
};

const ROLE_EMOJI: Record<AgentRole, string> = {
  planner: '🎯',
  coder: '💻',
  validator: '✓',
  writer: '📝',
  reviewer: '🔍',
  researcher: '🔬',
  executor: '⚡',
};

export type ViewMode = 'timeline' | 'conversation' | 'graph' | 'status';

export interface DistributedRendererConfig {
  showTimestamps: boolean;
  showProgress: boolean;
  showStateTransitions: boolean;
  showCausalOrder: boolean;
  showNodeIds: boolean;
  animate: boolean;
  updateInterval: number;
  viewMode: ViewMode;
  maxTimelineEntries: number;
  maxConversationEntries: number;
}

const DEFAULT_CONFIG: DistributedRendererConfig = {
  showTimestamps: true,
  showProgress: true,
  showStateTransitions: true,
  showCausalOrder: true,
  showNodeIds: true,
  animate: true,
  updateInterval: 100,
  viewMode: 'status',
  maxTimelineEntries: 50,
  maxConversationEntries: 30,
};

export interface TimelineEntry {
  timestamp: number;
  nodeId: string;
  agentId: string;
  role: AgentRole;
  event: string;
  causalRank: number;
  vectorClock: VectorClockSnapshot;
}

export interface ConversationEntry {
  timestamp: number;
  senderId: string;
  senderNode: string;
  role: AgentRole;
  content: string;
  type: string;
  causalDeps: string[];
}

export interface GraphNode {
  id: string;
  taskId: string;
  role: AgentRole;
  nodeId: string;
  status: string;
  vectorClock: VectorClockSnapshot;
  causalRank: number;
  parent?: string;
  children: string[];
}

export class DistributedCollaborationRenderer {
  private config: Required<DistributedRendererConfig>;
  private state: Map<string, DistributedThinkingState> = new Map();
  private previousStates: Map<string, DistributedThinkingState> = new Map();
  private nodeStates: Map<string, Map<string, DistributedThinkingState>> = new Map();
  private logs: string[] = [];
  private timeline: TimelineEntry[] = [];
  private conversations: Map<string, ConversationEntry[]> = new Map();
  private graphNodes: Map<string, GraphNode> = new Map();
  private maxLogs: number = 100;
  private listeners: Array<(output: string) => void> = [];
  private currentViewMode: ViewMode = 'status';

  constructor(config: Partial<DistributedRendererConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config } as Required<DistributedRendererConfig>;
    this.currentViewMode = this.config.viewMode;
  }

  setViewMode(mode: ViewMode): void {
    this.currentViewMode = mode;
  }

  private mapRoleToState(role: AgentRole): DistributedThinkingState {
    const stateMap: Record<AgentRole, DistributedThinkingState> = {
      planner: 'planning',
      coder: 'coding',
      validator: 'validating',
      reviewer: 'reviewing',
      writer: 'writing',
      researcher: 'researching',
      executor: 'executing',
    };
    return stateMap[role];
  }

  updateExecutionState(executions: Map<string, DistributedAgentExecution>): void {
    this.previousStates = new Map(this.state);

    for (const [nodeId, execution] of executions) {
      let newState: DistributedThinkingState;

      switch (execution.status) {
        case 'completed':
          newState = 'completed';
          break;
        case 'failed':
          newState = 'failed';
          break;
        case 'timeout':
          newState = 'timeout';
          break;
        case 'cancelled':
          newState = 'cancelled';
          break;
        case 'waiting-for-deps':
          newState = 'waiting-for-deps';
          break;
        case 'running':
          newState = this.mapRoleToState(execution.role);
          break;
        default:
          newState = 'idle';
      }

      const stateKey = `${execution.nodeId}:${nodeId}`;
      this.state.set(stateKey, newState);

      if (this.config.showStateTransitions && this.previousStates.get(stateKey) !== newState) {
        const nodeLabel = this.config.showNodeIds
          ? `${execution.nodeId}:${execution.role}`
          : execution.role;
        this.log(`${this.getAgentLabel(execution.role, nodeId)} [${nodeLabel}]: ${this.formatState(newState)}`);
        this.addTimelineEntry(execution, newState, 'state-change');
      }
    }
  }

  updateGraphState(nodes: ExecutionNode[], nodeId?: string): void {
    for (const node of nodes) {
      let newState: DistributedThinkingState;

      switch (node.status) {
        case 'completed':
          newState = 'completed';
          break;
        case 'failed':
          newState = 'failed';
          break;
        case 'running':
          newState = this.mapRoleToState(node.role);
          break;
        case 'ready':
          newState = 'waiting';
          break;
        default:
          newState = 'idle';
      }

      const stateKey = nodeId ? `${nodeId}:${node.id}` : node.id;
      this.state.set(stateKey, newState);
    }
  }

  private addTimelineEntry(
    execution: DistributedAgentExecution,
    _state: DistributedThinkingState,
    event: string
  ): void {
    const entry: TimelineEntry = {
      timestamp: Date.now(),
      nodeId: execution.nodeId,
      agentId: execution.agentId,
      role: execution.role,
      event,
      causalRank: execution.vectorClock ? this.calculateCausalRank(execution.vectorClock) : 0,
      vectorClock: execution.vectorClock || {},
    };

    this.timeline.push(entry);

    if (this.timeline.length > this.config.maxTimelineEntries) {
      this.timeline.shift();
    }
  }

  private calculateCausalRank(vectorClock: VectorClockSnapshot): number {
    const clockSum = Object.values(vectorClock).reduce((sum, val) => sum + val, 0);
    const uniqueNodes = Object.keys(vectorClock).length;
    return clockSum + uniqueNodes * 0.1;
  }

  addMessage(message: MessageWithCausality): void {
    const conversationKey = message.taskId;

    if (!this.conversations.has(conversationKey)) {
      this.conversations.set(conversationKey, []);
    }

    const conversation = this.conversations.get(conversationKey)!;

    const entry: ConversationEntry = {
      timestamp: message.timestamp,
      senderId: message.sender,
      senderNode: message.senderNode,
      role: message.role,
      content: message.content,
      type: message.type,
      causalDeps: message.causalDeps,
    };

    conversation.push(entry);

    if (conversation.length > this.config.maxConversationEntries) {
      conversation.shift();
    }

    const agentType = getAgentType(message.role);
    this.log(`[${message.senderNode}] ${agentType.name}: ${this.truncate(message.content, 80)}`);
  }

  updateGraphNode(task: CrossNodeTask): void {
    const node: GraphNode = {
      id: task.taskId,
      taskId: task.taskId,
      role: 'planner',
      nodeId: task.createdNode,
      status: task.status,
      vectorClock: task.vectorClock,
      causalRank: this.calculateCausalRank(task.vectorClock),
      parent: task.parentTaskId,
      children: task.childTaskIds,
    };

    this.graphNodes.set(task.taskId, node);
  }

  log(message: string): void {
    const timestamp = this.config.showTimestamps
      ? chalk.gray(`[${new Date().toLocaleTimeString()}] `)
      : '';
    const formatted = `${timestamp}${message}`;
    this.logs.push(formatted);

    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }

    this.notifyListeners(formatted);
  }

  renderProgress(completed: number, total: number, label?: string): string {
    const percentage = Math.round((completed / total) * 100);
    const filled = Math.round((percentage / 100) * 20);
    const bar = '█'.repeat(filled) + '░'.repeat(20 - filled);

    const labelStr = label ? ` ${label}` : '';
    return `${chalk.cyan(bar)} ${percentage}%${labelStr} (${completed}/${total})`;
  }

  renderDistributedAgentCard(execution: DistributedAgentExecution): string {
    const agentType = getAgentType(execution.role);
    const stateKey = `${execution.nodeId}:${execution.agentId}`;
    const state = this.state.get(stateKey) || 'idle';
    const stateColor = STATE_COLORS[state];
    const icon = STATE_ICONS[state];
    const emoji = ROLE_EMOJI[execution.role];

    const lines: string[] = [];
    const nodeLabel = this.config.showNodeIds ? `[${execution.nodeId}] ` : '';
    lines.push(chalk.bold(`${emoji} ${nodeLabel}${agentType.name}`));
    lines.push(stateColor(`${icon} ${this.formatState(state)}`));

    if (execution.startTime) {
      const duration = execution.endTime
        ? execution.endTime - execution.startTime
        : Date.now() - execution.startTime;
      lines.push(chalk.gray(`  Duration: ${this.formatDuration(duration)}`));
    }

    if (execution.vectorClock && this.config.showCausalOrder) {
      const clockStr = this.formatVectorClock(execution.vectorClock);
      lines.push(chalk.gray(`  VC: ${clockStr}`));
    }

    if (execution.error) {
      lines.push(chalk.red(`  Error: ${this.truncate(execution.error, 50)}`));
    }

    return lines.join('\n');
  }

  private formatVectorClock(clock: VectorClockSnapshot): string {
    const entries = Object.entries(clock)
      .map(([id, count]) => `${id.slice(0, 6)}:${count}`)
      .join(',');
    return `{${entries}}`;
  }

  renderTimeline(taskId?: string): string {
    const entries = taskId
      ? this.timeline.filter(e => {
          const graphNode = this.graphNodes.get(e.nodeId);
          return graphNode?.taskId === taskId;
        })
      : this.timeline;

    if (entries.length === 0) {
      return chalk.gray('No timeline entries');
    }

    const lines: string[] = [chalk.bold('Timeline:')];

    const sortedEntries = [...entries].sort((a, b) => a.causalRank - b.causalRank);

    for (const entry of sortedEntries) {
      const time = new Date(entry.timestamp).toLocaleTimeString();
      const agentLabel = this.config.showNodeIds
        ? `[${entry.nodeId}]${entry.role}`
        : entry.role;
      const icon = STATE_ICONS[this.getStateForEvent(entry.event)] || '○';
      lines.push(`  ${chalk.gray(time)} ${icon} ${agentLabel}: ${entry.event}`);
    }

    return lines.join('\n');
  }

  private getStateForEvent(event: string): DistributedThinkingState {
    if (event.includes('completed')) return 'completed';
    if (event.includes('failed')) return 'failed';
    if (event.includes('start')) return 'executing';
    if (event.includes('sync')) return 'syncing';
    if (event.includes('collaborate')) return 'collaborating';
    return 'idle';
  }

  renderConversation(taskId: string): string {
    const conversation = this.conversations.get(taskId);

    if (!conversation || conversation.length === 0) {
      return chalk.gray(`No conversation for task ${taskId}`);
    }

    const lines: string[] = [chalk.bold(`Conversation [${taskId}]:`)];

    const sortedMessages = [...conversation].sort((a, b) => a.timestamp - b.timestamp);

    for (const msg of sortedMessages) {
      const time = new Date(msg.timestamp).toLocaleTimeString();
      const agentLabel = this.config.showNodeIds
        ? `[${msg.senderNode}]${msg.role}`
        : msg.role;
      const typeLabel = chalk.gray(`[${msg.type}]`);

      lines.push(`  ${chalk.gray(time)} ${typeLabel} ${agentLabel}:`);
      lines.push(`    ${this.truncate(msg.content, 100)}`);

      if (msg.causalDeps.length > 0) {
        lines.push(`    ${chalk.gray('↳ depends on: ')}${msg.causalDeps.join(', ')}`);
      }
    }

    return lines.join('\n');
  }

  renderGraph(taskId?: string): string {
    const lines: string[] = [chalk.bold('Distributed Task Graph:')];

    if (this.graphNodes.size === 0) {
      return lines[0] + '\n' + chalk.gray('  No nodes in graph');
    }

    const nodes = Array.from(this.graphNodes.values());

    if (taskId) {
      const root = this.graphNodes.get(taskId);
      if (root) {
        this.renderGraphNode(root, 0, new Set<string>(), lines);
      }
    } else {
      for (const node of nodes) {
        if (!node.parent) {
          this.renderGraphNode(node, 0, new Set<string>(), lines);
        }
      }
    }

    return lines.join('\n');
  }

  private renderGraphNode(
    node: GraphNode,
    depth: number,
    visited: Set<string>,
    lines: string[]
  ): void {
    if (visited.has(node.id)) {
      lines.push('  '.repeat(depth) + chalk.gray(`↻ ${node.id} (cycle)`));
      return;
    }
    visited.add(node.id);

    const statusColor = this.getStatusColor(node.status);
    const nodeLabel = this.config.showNodeIds ? `[${node.nodeId}]` : '';
    const prefix = '  '.repeat(depth) + (depth > 0 ? '└─ ' : '');

    lines.push(`${prefix}${nodeLabel}${node.taskId} ${statusColor(`(${node.status})`)}`);

    if (this.config.showCausalOrder) {
      const clockStr = this.formatVectorClock(node.vectorClock);
      lines.push('  '.repeat(depth + 1) + chalk.gray(`VC: ${clockStr}`));
    }

    for (const childId of node.children) {
      const child = this.graphNodes.get(childId);
      if (child) {
        this.renderGraphNode(child, depth + 1, new Set(visited), lines);
      }
    }
  }

  private getStatusColor(status: string): ChalkFunction {
    switch (status) {
      case 'completed':
        return chalk.green;
      case 'failed':
        return chalk.red;
      case 'in-progress':
        return chalk.cyan;
      case 'assigned':
        return chalk.blue;
      default:
        return chalk.gray;
    }
  }

  renderCollaborationLoop(loop: CollaborationLoop): string {
    const statusColor = loop.status === 'active' ? chalk.green : loop.status === 'paused' ? chalk.yellow : chalk.gray;
    const lines: string[] = [];

    lines.push(chalk.bold(`Collaboration Loop [${loop.id}]:`));
    lines.push(`  Task: ${loop.taskId}`);
    lines.push(`  Phase: ${loop.currentPhase}`);
    lines.push(`  Status: ${statusColor(loop.status)}`);
    lines.push(`  Rounds: ${loop.rounds}`);
    lines.push(`  Participants: ${loop.participants.join(', ')}`);

    const syncAge = Date.now() - loop.lastSyncAt;
    lines.push(`  Last sync: ${this.formatDuration(syncAge)} ago`);

    return lines.join('\n');
  }

  renderResult(result: DistributedOrchestrationResult): string {
    const lines: string[] = [];

    lines.push(chalk.bold('\n=== Distributed Orchestration Result ==='));
    lines.push(`Status: ${result.success ? chalk.green('SUCCESS') : chalk.red('FAILED')}`);
    lines.push(`Execution time: ${this.formatDuration(result.executionTime)}`);

    lines.push(`\nCompleted: ${chalk.green(result.completedAgents.length)}`);
    for (const agent of result.completedAgents) {
      lines.push(`  ${chalk.green('●')} ${agent}`);
    }

    if (result.failedAgents.length > 0) {
      lines.push(`\nFailed: ${chalk.red(result.failedAgents.length)}`);
      for (const agent of result.failedAgents) {
        lines.push(`  ${chalk.red('✗')} ${agent}`);
      }
    }

    if (result.timedOutAgents.length > 0) {
      lines.push(`\nTimed out: ${chalk.yellow(result.timedOutAgents.length)}`);
      for (const agent of result.timedOutAgents) {
        lines.push(`  ${chalk.yellow('⏱')} ${agent}`);
      }
    }

    if (result.errors.length > 0) {
      lines.push(`\nErrors:`);
      for (const error of result.errors) {
        lines.push(`  ${chalk.red('●')} ${error}`);
      }
    }

    if (this.config.showCausalOrder && result.causalOrder.length > 0) {
      lines.push(`\nCausal Order:`);
      lines.push(`  ${chalk.gray('Vector clocks:')} ${result.causalOrder.length}`);
    }

    return lines.join('\n');
  }

  renderFull(viewMode?: ViewMode): string {
    const mode = viewMode || this.currentViewMode;

    switch (mode) {
      case 'timeline':
        return this.renderTimeline();
      case 'conversation':
        const taskIds = Array.from(this.conversations.keys());
        if (taskIds.length === 0) return chalk.gray('No conversations');
        return this.renderConversation(taskIds[0]);
      case 'graph':
        return this.renderGraph();
      case 'status':
      default:
        return this.renderStatus();
    }
  }

  private renderStatus(): string {
    const lines: string[] = [];

    lines.push(chalk.bold('Distributed Collaboration Status'));
    lines.push(`Active states: ${this.state.size}`);
    lines.push(`Timeline entries: ${this.timeline.length}`);
    lines.push(`Active conversations: ${this.conversations.size}`);
    lines.push(`Graph nodes: ${this.graphNodes.size}`);

    return lines.join('\n');
  }

  private getAgentLabel(role: AgentRole, nodeId: string): string {
    const agentType = getAgentType(role);
    return this.config.showNodeIds
      ? `${agentType.name}@${nodeId}`
      : agentType.name;
  }

  private formatState(state: DistributedThinkingState): string {
    return state.replace(/-/g, ' ');
  }

  private formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${minutes}m ${seconds}s`;
  }

  private truncate(str: string, maxLength: number): string {
    if (str.length <= maxLength) return str;
    return str.slice(0, maxLength - 3) + '...';
  }

  private notifyListeners(output: string): void {
    for (const listener of this.listeners) {
      try {
        listener(output);
      } catch {
        // Ignore listener errors
      }
    }
  }

  onOutput(listener: (output: string) => void): () => void {
    this.listeners.push(listener);
    return () => {
      const idx = this.listeners.indexOf(listener);
      if (idx >= 0) {
        this.listeners.splice(idx, 1);
      }
    };
  }

  clear(): void {
    this.state.clear();
    this.previousStates.clear();
    this.nodeStates.clear();
    this.logs = [];
    this.timeline = [];
    this.conversations.clear();
    this.graphNodes.clear();
  }

  getTimeline(): TimelineEntry[] {
    return [...this.timeline];
  }

  getConversations(): Map<string, ConversationEntry[]> {
    return new Map(this.conversations);
  }

  getGraphNodes(): Map<string, GraphNode> {
    return new Map(this.graphNodes);
  }

  getLogs(): string[] {
    return [...this.logs];
  }

  getActiveStateCount(): number {
    return Array.from(this.state.values()).filter(
      s => s !== 'completed' && s !== 'failed' && s !== 'idle' && s !== 'cancelled'
    ).length;
  }
}

let globalDistributedRenderer: DistributedCollaborationRenderer | null = null;

export function initDistributedRenderer(
  config?: Partial<DistributedRendererConfig>
): DistributedCollaborationRenderer {
  globalDistributedRenderer = new DistributedCollaborationRenderer(config);
  return globalDistributedRenderer;
}

export function getDistributedRenderer(): DistributedCollaborationRenderer | null {
  return globalDistributedRenderer;
}
