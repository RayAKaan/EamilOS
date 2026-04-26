export interface TerminalConfig {
  shell?: string;
  cols?: number;
  rows?: number;
  cwd: string;
  env?: Record<string, string>;
}

export interface CommandResult {
  success: boolean;
  output: string;
  exitCode: number;
  error?: string;
  durationMs: number;
}

export interface ITerminalExecutionProtocol {
  spawn(sessionId: string, config: TerminalConfig): Promise<string>;
  execute(sessionId: string, command: string, timeout?: number): Promise<CommandResult>;
  executeParallel(commands: Array<{ sessionId: string; command: string }>): Promise<Map<string, CommandResult>>;
  cleanup(sessionId: string): void;
}
