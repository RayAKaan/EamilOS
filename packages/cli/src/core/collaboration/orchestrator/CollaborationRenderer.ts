import chalk from 'chalk';
import type { AgentRole } from '../AgentType.js';
import { getAgentType } from '../AgentType.js';
import type { ExecutionNode } from '../ExecutionGraph.js';
import type { AgentExecution } from './IntelligentOrchestrator.js';
import type { OrchestrationResult } from './IntelligentOrchestrator.js';

type ChalkFunction = (str: string | number) => string;

export type ThinkingState =
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
  | 'completed'
  | 'failed'
  | 'timeout';

const STATE_COLORS: Record<ThinkingState, ChalkFunction> = {
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
  completed: chalk.green,
  failed: chalk.red,
  timeout: chalk.red,
};

const STATE_ICONS: Record<ThinkingState, string> = {
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
  completed: '●',
  failed: '✗',
  timeout: '⏱',
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

export interface RendererConfig {
  showTimestamps: boolean;
  showProgress: boolean;
  showStateTransitions: boolean;
  animate: boolean;
  updateInterval: number;
}

const DEFAULT_RENDERER_CONFIG: RendererConfig = {
  showTimestamps: true,
  showProgress: true,
  showStateTransitions: true,
  animate: true,
  updateInterval: 100,
};

export class CollaborationRenderer {
  private config: RendererConfig;
  private state: Map<string, ThinkingState> = new Map();
  private previousStates: Map<string, ThinkingState> = new Map();
  private logs: string[] = [];
  private maxLogs: number = 100;
  private updateTimer: ReturnType<typeof setInterval> | null = null;
  private listeners: Array<(output: string) => void> = [];

  constructor(config: Partial<RendererConfig> = {}) {
    this.config = { ...DEFAULT_RENDERER_CONFIG, ...config };
  }

  private mapRoleToState(role: AgentRole): ThinkingState {
    const stateMap: Record<AgentRole, ThinkingState> = {
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

  updateExecutionState(executions: Map<string, AgentExecution>): void {
    this.previousStates = new Map(this.state);

    for (const [nodeId, execution] of executions) {
      let newState: ThinkingState;

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
        case 'running':
          newState = this.mapRoleToState(execution.role);
          break;
        default:
          newState = 'idle';
      }

      this.state.set(nodeId, newState);

      if (this.config.showStateTransitions && this.previousStates.get(nodeId) !== newState) {
        this.log(`${this.getAgentLabel(execution.role, nodeId)}: ${this.formatState(newState)}`);
      }
    }
  }

  updateGraphState(nodes: ExecutionNode[]): void {
    for (const node of nodes) {
      let newState: ThinkingState;

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

      this.state.set(node.id, newState);
    }
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

  renderAgentCard(execution: AgentExecution): string {
    const agentType = getAgentType(execution.role);
    const state = this.state.get(execution.nodeId) || 'idle';
    const stateColor = STATE_COLORS[state];
    const icon = STATE_ICONS[state];
    const emoji = ROLE_EMOJI[execution.role];

    const lines: string[] = [];
    lines.push(chalk.bold(`${emoji} ${agentType.name}`));
    lines.push(stateColor(`${icon} ${this.formatState(state)}`));

    if (execution.startTime) {
      const duration = execution.endTime
        ? execution.endTime - execution.startTime
        : Date.now() - execution.startTime;
      lines.push(chalk.gray(`  Duration: ${this.formatDuration(duration)}`));
    }

    if (execution.error) {
      lines.push(chalk.red(`  Error: ${execution.error}`));
    }

    if (execution.result) {
      lines.push(chalk.green(`  Result: ${String(execution.result).slice(0, 50)}...`));
    }

    return lines.join('\n');
  }

  renderExecutionSummary(result: OrchestrationResult): string {
    const lines: string[] = [];
    lines.push('');
    lines.push(chalk.bold('━━━ Execution Summary ━━━'));
    lines.push('');

    lines.push(chalk.bold('Status: ') + (result.success ? chalk.green('SUCCESS') : chalk.red('FAILED')));

    if (result.executionTime) {
      lines.push(chalk.gray(`Total Time: ${this.formatDuration(result.executionTime)}`));
    }

    lines.push('');
    lines.push(chalk.bold('Agents:'));
    lines.push(`  ${chalk.green('✓')} Completed: ${result.completedAgents.length}`);
    lines.push(`  ${chalk.red('✗')} Failed: ${result.failedAgents.length}`);
    lines.push(`  ${chalk.yellow('⏱')} Timed Out: ${result.timedOutAgents.length}`);

    if (result.completedAgents.length > 0) {
      lines.push('');
      lines.push(chalk.green('Completed Agents:'));
      for (const agent of result.completedAgents) {
        lines.push(`  ${chalk.green('●')} ${agent}`);
      }
    }

    if (result.failedAgents.length > 0) {
      lines.push('');
      lines.push(chalk.red('Failed Agents:'));
      for (const agent of result.failedAgents) {
        lines.push(`  ${chalk.red('✗')} ${agent}`);
      }
    }

    if (result.timedOutAgents.length > 0) {
      lines.push('');
      lines.push(chalk.yellow('Timed Out Agents:'));
      for (const agent of result.timedOutAgents) {
        lines.push(`  ${chalk.yellow('⏱')} ${agent}`);
      }
    }

    if (result.errors.length > 0) {
      lines.push('');
      lines.push(chalk.red('Errors:'));
      for (const error of result.errors) {
        lines.push(`  ${chalk.red('●')} ${error}`);
      }
    }

    lines.push('');
    return lines.join('\n');
  }

  renderExecutionGraph(nodes: ExecutionNode[]): string {
    if (nodes.length === 0) {
      return chalk.gray('No nodes in execution graph');
    }

    const lines: string[] = [];
    lines.push(chalk.bold('━━━ Execution Graph ━━━'));
    lines.push('');

    const sortedNodes = [...nodes].sort((a, b) => {
      const phaseA = this.getNodePhase(a);
      const phaseB = this.getNodePhase(b);
      return phaseA - phaseB;
    });

    let currentPhase = -1;
    for (const node of sortedNodes) {
      const phase = this.getNodePhase(node);

      if (phase !== currentPhase) {
        if (currentPhase >= 0) {
          lines.push('');
        }
        currentPhase = phase;
        lines.push(chalk.bold.cyan(`Phase ${phase}:`));
      }

      const state = this.state.get(node.id) || 'idle';
      const stateColor = STATE_COLORS[state];
      const icon = STATE_ICONS[state];
      const agentType = getAgentType(node.role);

      const statusStr = stateColor(`[${icon} ${this.formatState(state)}]`);
      const nameStr = chalk.bold(agentType.name);
      const depsStr = node.dependencies.length > 0
        ? chalk.gray(` (deps: ${node.dependencies.length})`)
        : '';

      lines.push(`  ${statusStr} ${nameStr}${depsStr}`);

      if (node.startTime && node.endTime) {
        const duration = node.endTime - node.startTime;
        lines.push(chalk.gray(`    Duration: ${this.formatDuration(duration)}`));
      }

      if (node.error) {
        lines.push(chalk.red(`    Error: ${node.error}`));
      }
    }

    lines.push('');
    return lines.join('\n');
  }

  private getNodePhase(node: ExecutionNode): number {
    if (node.status === 'pending') return 0;
    if (node.status === 'ready') return 1;

    if (node.startTime) {
      return Math.floor((node.startTime - this.getEarliestStart(node)) / 10000) + 2;
    }

    return 2;
  }

  private getEarliestStart(node: ExecutionNode): number {
    if (node.dependencies.length === 0) {
      return node.startTime || Date.now();
    }

    let earliest = Date.now();
    for (const _depId of node.dependencies) {
      if (node.startTime && node.startTime < earliest) {
        earliest = node.startTime;
      }
    }

    return earliest;
  }

  private formatState(state: ThinkingState): string {
    const formatted: Record<ThinkingState, string> = {
      idle: 'Idle',
      planning: 'Planning...',
      analyzing: 'Analyzing...',
      researching: 'Researching...',
      coding: 'Coding...',
      validating: 'Validating...',
      reviewing: 'Reviewing...',
      writing: 'Writing...',
      executing: 'Executing...',
      waiting: 'Waiting...',
      completed: 'Completed',
      failed: 'Failed',
      timeout: 'Timeout',
    };
    return formatted[state];
  }

  private formatDuration(ms: number): string {
    if (ms < 1000) {
      return `${ms}ms`;
    }
    if (ms < 60000) {
      return `${(ms / 1000).toFixed(1)}s`;
    }
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${minutes}m ${seconds}s`;
  }

  private getAgentLabel(role: AgentRole, nodeId: string): string {
    const agentType = getAgentType(role);
    const state = this.state.get(nodeId) || 'idle';
    const stateColor = STATE_COLORS[state];
    return stateColor(`[${agentType.name}] ${this.formatState(state)}`);
  }

  startAutoUpdate(
    getExecutions: () => Map<string, AgentExecution>,
    getNodes: () => ExecutionNode[]
  ): void {
    if (this.updateTimer) {
      return;
    }

    this.updateTimer = setInterval(() => {
      const executions = getExecutions();
      const nodes = getNodes();

      this.updateExecutionState(executions);
      this.updateGraphState(nodes);

      this.notifyListeners(this.render(nodes, executions));
    }, this.config.updateInterval);
  }

  stopAutoUpdate(): void {
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
      this.updateTimer = null;
    }
  }

  render(nodes: ExecutionNode[], executions: Map<string, AgentExecution>): string {
    const lines: string[] = [];

    if (this.config.showProgress) {
      const completed = executions.size;
      lines.push(this.renderProgress(completed, nodes.length || completed, 'agents'));
      lines.push('');
    }

    lines.push(this.renderExecutionGraph(nodes));

    if (this.logs.length > 0) {
      lines.push('');
      lines.push(chalk.bold('━━━ Recent Activity ━━━'));
      for (const log of this.logs.slice(-10)) {
        lines.push(log);
      }
    }

    return lines.join('\n');
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

  private notifyListeners(output: string): void {
    for (const listener of this.listeners) {
      try {
        listener(output);
      } catch {
        // Ignore listener errors
      }
    }
  }

  clear(): void {
    this.state.clear();
    this.previousStates.clear();
    this.logs = [];
  }

  getState(): Map<string, ThinkingState> {
    return new Map(this.state);
  }

  getLogs(): string[] {
    return [...this.logs];
  }
}
