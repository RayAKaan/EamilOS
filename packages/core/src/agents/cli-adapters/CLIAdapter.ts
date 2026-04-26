import * as fs from 'fs/promises';
import * as path from 'path';
import { IAgentProtocol, AgentIdentity, AgentCapability } from '../../protocols/agent-protocol.js';
import { TerminalOrchestrator } from '../../execution/TerminalOrchestrator.js';
import type { Task } from '../../schemas/task.js';

export interface CLIAdapterConfig {
  cliPath: string;
  defaultArgs?: string[];
  env?: Record<string, string>;
}

export abstract class CLIAdapter implements IAgentProtocol {
  protected sessionId?: string;
  protected available: boolean = false;

  constructor(
    protected agentId: string,
    protected name: string,
    protected terminalOrchestrator: TerminalOrchestrator,
    protected config: CLIAdapterConfig
  ) {}

  protected getConfig(): CLIAdapterConfig {
    return this.config;
  }

  async initialize(): Promise<boolean> {
    this.available = await this.isCLIAvailable();
    if (!this.available) {
      console.warn(`CLI ${this.config.cliPath} not available - adapter will noop`);
    }
    return this.available;
  }

  private async isCLIAvailable(): Promise<boolean> {
    if (path.isAbsolute(this.config.cliPath)) {
      try {
        await fs.access(this.config.cliPath);
        return true;
      } catch {
        return false;
      }
    }
    
    const pathEnv = process.env.PATH || '';
    const pathDirs = pathEnv.split(process.platform === 'win32' ? ';' : ':');
    
    for (const dir of pathDirs) {
      try {
        const fullPath = path.join(dir, this.config.cliPath);
        await fs.access(fullPath);
        return true;
      } catch {
        continue;
      }
    }
    
    return false;
  }

  abstract getCapabilities(): AgentCapability[];

  getIdentity(): AgentIdentity {
    return {
      id: this.agentId,
      name: this.name,
      type: 'cli',
      capabilities: this.getCapabilities(),
      health: {
        status: this.available ? 'healthy' : 'unavailable',
        score: this.available ? 100 : 0,
        lastCheck: Date.now()
      },
      metadata: {
        cliPath: this.config.cliPath
      }
    };
  }

  async execute(task: Task, context: Record<string, unknown>): Promise<{
    success: boolean;
    output?: string;
    artifacts?: string[];
    error?: string;
    metadata?: Record<string, unknown>;
  }> {
    if (!this.available) {
      return {
        success: false,
        output: '',
        error: `CLI ${this.config.cliPath} is not available`
      };
    }

    if (!this.sessionId) {
      this.sessionId = await this.terminalOrchestrator.spawn(
        `session_${this.agentId}`,
        {
          cwd: process.cwd(),
          env: {
            ...this.config.env,
            AGENT_ID: this.agentId,
            AGENT_CONTEXT: JSON.stringify(context)
          }
        }
      );
    }

    const command = this.buildCommand(task, context);
    const result = await this.terminalOrchestrator.execute(this.sessionId, command);

    return {
      success: result.success,
      output: result.output,
      artifacts: this.parseArtifacts(result.output),
      metadata: {
        exitCode: result.exitCode,
        durationMs: result.durationMs
      }
    };
  }

  abstract buildCommand(task: Task, context: Record<string, unknown>): string;
  abstract parseArtifacts(output: string): string[];

  async communicate(_message: {
    from: string;
    content: string;
    timestamp: number;
  }): Promise<void> {
    if (this.sessionId) {
      await this.terminalOrchestrator.execute(this.sessionId, 'echo "pong"');
    }
  }

  cleanup(): void {
    if (this.sessionId) {
      this.terminalOrchestrator.cleanup(this.sessionId);
      this.sessionId = undefined;
    }
  }
}