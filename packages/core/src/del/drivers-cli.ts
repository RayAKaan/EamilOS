import { spawn } from 'child_process';
import { BaseProviderDriver } from './driver-base.js';
import {
  ExecutionRequest,
  RawProviderOutput,
  ProviderCapability,
  ProviderHealth,
  ProviderType,
} from './provider-types.js';

export interface CLIProviderConfig {
  command: string;
  args?: string[];
  workingDirectory?: string;
  timeoutMs?: number;
  env?: Record<string, string>;
}

export class CLIProviderDriver extends BaseProviderDriver {
  id: string;
  name: string;
  type: ProviderType = 'cli';
  capabilities: ProviderCapability[] = [
    'code_generation',
    'system_design',
    'reasoning',
    'documentation',
    'testing',
    'multi_file_edit',
    'code_review',
    'refactoring',
  ];
  private cliConfig: CLIProviderConfig;

  constructor(id: string, name: string, config: CLIProviderConfig) {
    super();
    this.id = id;
    this.name = name;
    this.cliConfig = {
      args: [],
      timeoutMs: 120000,
      ...config,
    };
  }

  async initialize(config: Record<string, unknown>): Promise<void> {
    await super.initialize(config);
    this.cliConfig = { ...this.cliConfig, ...config };
  }

  async healthCheck(): Promise<ProviderHealth> {
    const startTime = Date.now();
    try {
      const result = await this.runCommand(['--version']);

      return {
        status: result.exitCode === 0 ? 'healthy' : 'degraded',
        avgLatencyMs: Date.now() - startTime,
        successRate: result.exitCode === 0 ? 1.0 : 0.0,
        lastChecked: Date.now(),
      };
    } catch {
      return {
        status: 'offline',
        avgLatencyMs: Date.now() - startTime,
        successRate: 0.0,
        lastChecked: Date.now(),
      };
    }
  }

  async execute(request: ExecutionRequest): Promise<RawProviderOutput> {
    this.ensureInitialized();

    const startTime = Date.now();
    const timeout = request.constraints?.timeoutMs || this.cliConfig.timeoutMs || 120000;

    const args = [
      ...(this.cliConfig.args || []),
      this.sanitizePrompt(request.prompt),
    ];

    try {
      const result = await this.runCommandWithTimeout(args, timeout);

      const latency = Date.now() - startTime;

      return {
        providerId: this.id,
        rawText: result.stdout,
        exitCode: result.exitCode,
        metadata: {
          model: this.id,
          latencyMs: latency,
        },
      };
    } catch (error) {
      const latency = Date.now() - startTime;
      throw new Error(`CLI execution failed after ${latency}ms: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private sanitizePrompt(prompt: string): string {
    return prompt
      .replace(/[;&|`$]/g, '\\$&')
      .replace(/\$/g, '\\$')
      .replace(/`/g, '\\`')
      .substring(0, 5000);
  }

  private runCommand(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.cliConfig.command, args, {
        cwd: this.cliConfig.workingDirectory || process.cwd(),
        env: { ...process.env, ...this.cliConfig.env },
        shell: false,
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('error', (error) => {
        reject(error);
      });

      child.on('close', (code) => {
        resolve({
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          exitCode: code || 0,
        });
      });
    });
  }

  private runCommandWithTimeout(args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.cliConfig.command, args, {
        cwd: this.cliConfig.workingDirectory || process.cwd(),
        env: { ...process.env, ...this.cliConfig.env },
        shell: false,
      });

      let stdout = '';
      let stderr = '';

      const timeoutHandle = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`Command timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('error', (error) => {
        clearTimeout(timeoutHandle);
        reject(error);
      });

      child.on('close', (code) => {
        clearTimeout(timeoutHandle);
        resolve({
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          exitCode: code || 0,
        });
      });
    });
  }
}

export class ClaudeCLIDriver extends CLIProviderDriver {
  constructor() {
    super('cli:claude', 'Claude CLI', {
      command: 'claude',
      args: ['-p'],
      timeoutMs: 120000,
    });
  }
}

export class CodeXCLIDriver extends CLIProviderDriver {
  constructor() {
    super('cli:codex', 'CodeX CLI', {
      command: 'codex',
      args: ['exec'],
      timeoutMs: 120000,
    });
  }
}