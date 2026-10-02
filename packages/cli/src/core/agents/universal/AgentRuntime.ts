import { nanoid } from 'nanoid';
import { getTerminalSessionManager } from '../../terminal/TerminalSessionManager.js';
import type { AgentRequest, AgentResponse } from '../types.js';
import type { UniversalAgentDefinition } from './types.js';

export interface UniversalAgentSession {
  id: string;
  agentId: string;
  terminalId: string;
  startedAt: number;
  status: 'starting' | 'running' | 'completed' | 'failed' | 'stopped';
}

export interface UniversalRuntimeOptions {
  workingDir: string;
  timeoutMs?: number;
}

export class UniversalAgentRuntime {
  private sessions = new Map<string, UniversalAgentSession>();

  constructor(
    private readonly definition: UniversalAgentDefinition,
    private readonly options: UniversalRuntimeOptions,
  ) {}

  async createSession(): Promise<UniversalAgentSession> {
    const command = this.definition.executableCandidates[0];
    if (!command) throw new Error('No executable configured for ' + this.definition.id);

    const terminal = await getTerminalSessionManager().createSession(
      this.definition.id,
      command,
      [],
      this.options.workingDir,
      'execution',
    );

    const session: UniversalAgentSession = {
      id: nanoid(12),
      agentId: this.definition.id,
      terminalId: terminal.id,
      startedAt: Date.now(),
      status: terminal.status === 'running' ? 'running' : 'failed',
    };
    this.sessions.set(session.id, session);
    return session;
  }

  async execute(request: AgentRequest): Promise<AgentResponse> {
    const startedAt = Date.now();
    const session = await this.createSession();
    const terminalManager = getTerminalSessionManager();
    const terminal = terminalManager.getSession(session.terminalId);
    if (!terminal) {
      return {
        agentId: this.definition.id, success: false, content: '', fileChanges: [],
        error: 'Terminal session disappeared', errorType: 'crash', durationMs: Date.now() - startedAt,
      };
    }

    const promptArgs = this.definition.runArgs ? this.definition.runArgs(request.prompt) : [];
    if (promptArgs.length > 0) {
      // Generic runtimes cannot safely mutate argv after process creation.
      // Restart with the provider's declared headless invocation when available.
      await terminalManager.stopSession(session.terminalId);
      const replacement = await terminalManager.createSession(
        this.definition.id,
        this.definition.executableCandidates[0],
        promptArgs,
        request.workingDir || this.options.workingDir,
        request.mode,
      );
      session.status = replacement.status === 'running' ? 'running' : 'failed';
      session.terminalId = replacement.id;
    } else {
      terminalManager.write(session.terminalId, request.prompt + '\n');
    }

    return await new Promise<AgentResponse>((resolve) => {
      let output = '';
      let settled = false;
      const timeoutMs = request.timeoutMs || this.options.timeoutMs || 180000;
      const finish = (response: AgentResponse) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        cleanup();
        resolve(response);
      };
      const onOutput = (event: { sessionId: string; agentId: string; data: string }) => {
        if (event.sessionId !== session.terminalId) return;
        output += event.data;
        request.onOutput?.(event.data);
      };
      const onExit = (event: { sessionId: string; agentId: string; exitCode: number }) => {
        if (event.sessionId !== session.terminalId) return;
        session.status = event.exitCode === 0 ? 'completed' : 'failed';
        finish({
          agentId: this.definition.id,
          success: event.exitCode === 0,
          content: output,
          fileChanges: [],
          rawOutput: output,
          error: event.exitCode === 0 ? undefined : output || 'Agent exited with code ' + event.exitCode,
          errorType: event.exitCode === 0 ? undefined : 'unknown',
          durationMs: Date.now() - startedAt,
        });
      };
      const onFailed = (event: { sessionId: string; agentId: string; error: string }) => {
        if (event.sessionId !== session.terminalId) return;
        session.status = 'failed';
        finish({
          agentId: this.definition.id, success: false, content: output, fileChanges: [],
          rawOutput: output, error: event.error, errorType: 'crash', durationMs: Date.now() - startedAt,
        });
      };
      const cleanup = () => {
        terminalManager.off('session:output', onOutput);
        terminalManager.off('session:exited', onExit);
        terminalManager.off('session:failed', onFailed);
      };
      terminalManager.on('session:output', onOutput);
      terminalManager.on('session:exited', onExit);
      terminalManager.on('session:failed', onFailed);
      const timer = setTimeout(() => {
        session.status = 'failed';
        void terminalManager.stopSession(session.terminalId);
        finish({
          agentId: this.definition.id, success: false, content: output, fileChanges: [],
          rawOutput: output, error: 'Agent execution timed out', errorType: 'timeout', durationMs: Date.now() - startedAt,
        });
      }, timeoutMs);
    });
  }

  async stop(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    await getTerminalSessionManager().stopSession(session.terminalId);
    session.status = 'stopped';
  }

  getSession(sessionId: string): UniversalAgentSession | undefined {
    return this.sessions.get(sessionId);
  }
}
