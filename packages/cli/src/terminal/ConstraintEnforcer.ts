import { tmpdir } from 'os';
import { EventEmitter } from 'events';
import { spawn } from 'child_process';
import { mkdtempSync, readdirSync, cpSync, rmSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { AgentMode } from '../core/agents/types.js';

export type AgentOperationalMode = 'communication' | 'execution';

export class ConstraintEnforcer extends EventEmitter {
  private isolatedDirs: Map<string, string> = new Map();

  checkToolAllowed(
    tool: string,
    mode: AgentOperationalMode,
    callsign: string,
    agentId: string
  ): boolean {
    if (mode === 'execution') return true;
    return false;
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

  createIsolatedContext(agentId: string, originalDir: string): string {
    const tmpDir = mkdtempSync(join(tmpdir(), 'eamilos-agent-'));
    const isoDir = join(tmpDir, 'workspace');
    mkdirSync(isoDir, { recursive: true });
    this.isolatedDirs.set(agentId, isoDir);

    if (existsSync(originalDir)) {
      try {
        const entries = readdirSync(originalDir);
        for (const entry of entries) {
          if (entry === '.git' || entry === 'node_modules' || entry === '.eamilos') continue;
          const src = join(originalDir, entry);
          const dst = join(isoDir, entry);
          try {
            cpSync(src, dst, { recursive: true, force: true });
          } catch { }
        }
      } catch { }
    }

    this.emit('constraint:isolated', { agentId, originalDir, isolatedDir: isoDir });
    return isoDir;
  }

  cleanupIsolatedContext(agentId: string): void {
    const dir = this.isolatedDirs.get(agentId);
    if (dir) {
      try { rmSync(dir, { recursive: true, force: true }); } catch { }
      this.isolatedDirs.delete(agentId);
    }
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
