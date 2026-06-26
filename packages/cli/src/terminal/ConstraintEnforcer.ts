import { EventEmitter } from 'events';
import type { AgentOperationalMode } from './AdaptiveMultiplexer.js';

export type RestrictedTool =
  | 'workspace_write'
  | 'edit_file'
  | 'bash'
  | 'shell_exec'
  | 'file_write'
  | 'fs_write';

export interface ConstraintViolation {
  callsign: string;
  agentId: string;
  tool: string;
  mode: AgentOperationalMode;
  timestamp: number;
  message: string;
}

const RESTRICTED_TOOLS: RestrictedTool[] = [
  'workspace_write',
  'edit_file',
  'bash',
  'shell_exec',
  'file_write',
  'fs_write',
];

export class ConstraintEnforcer extends EventEmitter {
  private violations: ConstraintViolation[] = [];

  checkToolAllowed(
    tool: string,
    mode: AgentOperationalMode,
    callsign: string,
    agentId: string
  ): boolean {
    if (mode === 'unrestricted_execution') return true;

    if (mode === 'communication_only' && this.isRestricted(tool)) {
      this.recordViolation({ callsign, agentId, tool, mode, timestamp: Date.now(), message: `Blocked ${tool} in COMMUNICATION_ONLY mode` });
      return false;
    }

    return true;
  }

  assertToolAllowed(
    tool: string,
    mode: AgentOperationalMode,
    callsign: string,
    agentId: string
  ): void {
    if (!this.checkToolAllowed(tool, mode, callsign, agentId)) {
      throw new ConstraintError(
        `[ConstraintEnforcer] Permission trap: "${tool}" is blocked in ${mode} mode for agent "${callsign}" (${agentId}). ` +
        `Only communication channels (read/search) are permitted.`
      );
    }
  }

  wrapExecution<T>(
    tool: string,
    mode: AgentOperationalMode,
    callsign: string,
    agentId: string,
    fn: () => T
  ): T {
    this.assertToolAllowed(tool, mode, callsign, agentId);
    return fn();
  }

  async wrapAsyncExecution<T>(
    tool: string,
    mode: AgentOperationalMode,
    callsign: string,
    agentId: string,
    fn: () => Promise<T>
  ): Promise<T> {
    this.assertToolAllowed(tool, mode, callsign, agentId);
    return fn();
  }

  getViolations(callsign?: string): ConstraintViolation[] {
    if (callsign) {
      return this.violations.filter(v => v.callsign === callsign);
    }
    return [...this.violations];
  }

  getViolationCount(): number {
    return this.violations.length;
  }

  clearViolations(): void {
    this.violations = [];
  }

  private isRestricted(tool: string): boolean {
    return RESTRICTED_TOOLS.includes(tool as RestrictedTool);
  }

  private recordViolation(violation: ConstraintViolation): void {
    this.violations.push(violation);
    this.emit('constraint:violation', violation);
    this.emit('constraint:blocked', {
      callsign: violation.callsign,
      tool: violation.tool,
      message: violation.message,
    });
  }
}

export class ConstraintError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConstraintError';
  }
}

let globalEnforcer: ConstraintEnforcer | null = null;

export function getConstraintEnforcer(): ConstraintEnforcer {
  if (!globalEnforcer) {
    globalEnforcer = new ConstraintEnforcer();
  }
  return globalEnforcer;
}
