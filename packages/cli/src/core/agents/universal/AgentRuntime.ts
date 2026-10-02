import { nanoid } from 'nanoid';
import { getTerminalSessionManager } from '../../terminal/TerminalSessionManager.js';
import type { AgentRequest, AgentResponse } from '../types.js';
import type { UniversalAgentDefinition, UniversalAgentSession } from './types.js';
import type { UniversalAgentEventBus } from './AgentEventBus.js';

export interface UniversalRuntimeOptions {
  workingDir: string;
  timeoutMs?: number;
  events?: UniversalAgentEventBus;
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
      this.definition.id, command, [], this.options.workingDir, 'execution',
    );
    const session: UniversalAgentSession = {
      id: nanoid(12), agentId: this.definition.id, terminalId: terminal.id,
      startedAt: Date.now(), status: terminal.status === 'running' ? 'running' : 'failed',
    };
    this.sessions.set(session.id, session);
    this.options.events?.emitEvent({ type: 'agent:session-started', agentId: session.agentId, sessionId: session.id, terminalId: session.terminalId, timestamp: Date.now() });
    return session;
  }

  async execute(request: AgentRequest): Promise<AgentResponse> {
    const startedAt = Date.now();
    const session = await this.createSession();
    const manager = getTerminalSessionManager();
    let terminalId = session.terminalId;
    const initial = manager.getSession(terminalId);
    if (!initial) return this.failure(session, 'Terminal session disappeared', 'crash', startedAt);

    const args = this.definition.runArgs ? this.definition.runArgs(request.prompt) : [];
    if (args.length > 0) {
      await manager.stopSession(terminalId);
      const replacement = await manager.createSession(this.definition.id, this.definition.executableCandidates[0], args, request.workingDir || this.options.workingDir, request.mode);
      terminalId = replacement.id;
      session.terminalId = terminalId;
      session.status = replacement.status === 'running' ? 'running' : 'failed';
    } else {
      manager.write(terminalId, request.prompt + '\n');
    }

    return await new Promise<AgentResponse>((resolve) => {
      let output = ''; let settled = false;
      const timeoutMs = request.timeoutMs || this.options.timeoutMs || 180000;
      const finish = (response: AgentResponse) => {
        if (settled) return;
        settled = true; clearTimeout(timer); cleanup();
        this.options.events?.emitEvent(response.success
          ? { type: 'agent:completed', agentId: this.definition.id, sessionId: session.id, success: true, timestamp: Date.now() }
          : { type: 'agent:failed', agentId: this.definition.id, sessionId: session.id, error: response.error ?? 'agent failed', timestamp: Date.now() });
        resolve(response);
      };
      const onOutput = (event: { sessionId: string; agentId: string; data: string }) => {
        if (event.sessionId !== terminalId) return;
        output += event.data;
        request.onOutput?.(event.data);
        this.options.events?.emitEvent({ type: 'agent:output', agentId: this.definition.id, sessionId: session.id, data: event.data, timestamp: Date.now() });
      };
      const onExit = (event: { sessionId: string; agentId: string; exitCode: number }) => {
        if (event.sessionId !== terminalId) return;
        session.status = event.exitCode === 0 ? 'completed' : 'failed';
        finish({ agentId: this.definition.id, success: event.exitCode === 0, content: output, fileChanges: [], rawOutput: output,
          error: event.exitCode === 0 ? undefined : output || 'Agent exited with code ' + event.exitCode,
          errorType: event.exitCode === 0 ? undefined : 'unknown', durationMs: Date.now() - startedAt });
      };
      const onFailed = (event: { sessionId: string; agentId: string; error: string }) => {
        if (event.sessionId !== terminalId) return;
        session.status = 'failed';
        finish(this.failure(session, event.error, 'crash', startedAt, output));
      };
      const cleanup = () => {
        manager.off('session:output', onOutput); manager.off('session:exited', onExit); manager.off('session:failed', onFailed);
      };
      manager.on('session:output', onOutput); manager.on('session:exited', onExit); manager.on('session:failed', onFailed);
      const timer = setTimeout(() => {
        session.status = 'failed';
        void manager.stopSession(terminalId);
        this.options.events?.emitEvent({ type: 'agent:recovery-requested', agentId: this.definition.id, sessionId: session.id, reason: 'execution timeout', timestamp: Date.now() });
        finish(this.failure(session, 'Agent execution timed out', 'timeout', startedAt, output));
      }, timeoutMs);
    });
  }

  async stop(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    await getTerminalSessionManager().stopSession(session.terminalId);
    session.status = 'stopped';
    this.options.events?.emitEvent({ type: 'agent:stopped', agentId: this.definition.id, sessionId, timestamp: Date.now() });
  }

  getSession(sessionId: string): UniversalAgentSession | undefined { return this.sessions.get(sessionId); }
  getSessions(): UniversalAgentSession[] { return [...this.sessions.values()]; }

  private failure(session: UniversalAgentSession, error: string, errorType: AgentResponse['errorType'], startedAt: number, output = ''): AgentResponse {
    session.status = 'failed';
    return { agentId: this.definition.id, success: false, content: output, fileChanges: [], rawOutput: output, error, errorType, durationMs: Date.now() - startedAt };
  }
}
