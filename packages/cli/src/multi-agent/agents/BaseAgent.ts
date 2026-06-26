import { spawn, SpawnOptions, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { buildAgentEnv, buildSafeEnv } from '../../core/security/AgentEnv.js';
import { getStagingWorkspace } from '../../core/workspace/StagingWorkspace.js';
import { classifyAgentError } from '../../core/agents/AgentErrorClassifier.js';
import { takeWorkspaceSnapshot, diffWorkspace } from '../../core/changes/ChangeCollector.js';
import type { AgentMode } from '../../core/agents/types.js';
import type { AgentErrorType } from '../../core/agents/types.js';
import type { FileChange } from '../../core/changes/ChangeCollector.js';

export function crossSpawn(cmd: string, args: string[], opts: SpawnOptions = {}) {
  if (process.platform === 'win32') {
    return spawn('cmd.exe', ['/d', '/c', cmd, ...args], opts);
  }
  return spawn(cmd, args, opts);
}

export interface AgentCapability {
  strengths: string[];
  weaknesses: string[];
  supportedLanguages: string[];
  maxContextTokens: number;
  tools: string[];
}

export interface AgentConfig {
  workingDir?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  model?: string;
  mode?: AgentMode;
  stagingEnabled?: boolean;
}

export interface TerminalMessage {
  id: string;
  timestamp: number;
  content: string;
  raw?: string;
  tools?: ToolCall[];
  metadata?: Record<string, unknown>;
}

export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
  result?: string;
  success?: boolean;
}

export interface HealthStatus {
  available: boolean;
  version?: string;
  error?: string;
}

export abstract class BaseAgent extends EventEmitter {
  protected process: ChildProcess | null = null;
  protected sessionId: string;
  protected config: AgentConfig;
  protected pendingMessages = new Map<string, (msg: TerminalMessage) => void>();
  protected startTime = 0;
  protected messageCount = 0;
  protected mode: AgentMode = 'execution';
  protected detectedChanges: FileChange[] = [];

  abstract readonly name: string;
  abstract readonly command: string;
  abstract readonly installCheck: string[];
  abstract readonly capabilities: AgentCapability;

  constructor(config: AgentConfig = {}) {
    super();
    this.config = {
      timeoutMs: 60000,
      workingDir: process.cwd(),
      mode: 'execution',
      stagingEnabled: false,
      ...config,
    };
    this.mode = this.config.mode ?? 'execution';
    this.sessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  async checkInstalled(): Promise<HealthStatus> {
    const { execFileSync } = await import('child_process');
    try {
      const [cmd, ...args] = this.installCheck;
      const result = execFileSync(cmd, args, {
        timeout: 10000,
        encoding: 'utf-8',
        windowsHide: true,
      });
      return {
        available: true,
        version: result.trim(),
      };
    } catch (err) {
      return {
        available: false,
        error: (err as Error).message,
      };
    }
  }

  protected async spawnProcess(command: string, args: string[], agentId?: string): Promise<void> {
    return new Promise((resolve) => {
      const fullEnv = buildAgentEnv(agentId || this.name, this.config.env);

      this.process = crossSpawn(command, args, {
        cwd: this.config.workingDir,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: fullEnv,
      });

      this.process.stdout?.on('data', (data: Buffer) => {
        this.handleStdout(data.toString());
      });

      this.process.stderr?.on('data', (data: Buffer) => {
        this.handleStderr(data.toString());
      });

      this.process.on('error', (err) => {
        this.emit('error', err);
      });

      this.process.on('exit', (code, signal) => {
        this.emit('exit', { code, signal });
        this.process = null;
      });

      setTimeout(resolve, 2000);
    });
  }

  protected abstract handleStdout(data: string): void;
  protected abstract handleStderr(data: string): void;

  abstract send(message: string): Promise<TerminalMessage>;

  protected emitChunk(agentName: string, chunk: string): void {
    this.emit('chunk', agentName, chunk);
  }

  protected createMessage(
    id: string,
    content: string,
    raw?: string,
    tools?: ToolCall[],
    metadata?: Record<string, unknown>
  ): TerminalMessage {
    return {
      id,
      timestamp: Date.now(),
      content,
      raw,
      tools,
      metadata,
    };
  }

  setMode(mode: AgentMode): void {
    this.mode = mode;
    this.config.mode = mode;
  }

  getMode(): AgentMode {
    return this.mode;
  }

  buildSafeEnv(): Record<string, string> {
    return buildSafeEnv(this.config.env);
  }

  protected getStagingDir(): string | undefined {
    if (!this.config.stagingEnabled) return undefined;
    const ws = getStagingWorkspace();
    const session = ws.createSession(this.name, this.config.workingDir ?? process.cwd());
    return session.workspaceDir;
  }

  protected detectChanges(beforeDir: string, afterDir: string): FileChange[] {
    const before = takeWorkspaceSnapshot(beforeDir);
    const after = takeWorkspaceSnapshot(afterDir);
    this.detectedChanges = diffWorkspace(before, after, afterDir, this.name);
    return this.detectedChanges;
  }

  protected classifyError(stderr: string, stdout?: string): AgentErrorType {
    return classifyAgentError(stderr, stdout);
  }

  async terminate(): Promise<void> {
    if (this.process) {
      this.process.stdin?.write('\x03');
      setTimeout(() => {
        this.process?.kill('SIGTERM');
        this.process = null;
      }, 3000);
    }
  }

  getSessionInfo() {
    return {
      id: this.sessionId,
      name: this.name,
      mode: this.mode,
      uptime: this.startTime ? Date.now() - this.startTime : 0,
      messageCount: this.messageCount,
    };
  }

  protected generateId(): string {
    return `${this.name}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  }
}
