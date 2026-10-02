import { nanoid } from 'nanoid';
import { getTerminalSessionManager } from '../../terminal/TerminalSessionManager.js';
import type { AgentRequest, AgentResponse } from '../types.js';
import type { UniversalAgentDefinition, UniversalAgentSession } from './types.js';
import type { UniversalAgentEventBus } from './AgentEventBus.js';
import { createLaunchContract } from './AgentLaunchContract.js';
import { ExecutionStore } from './ExecutionStore.js';

export interface UniversalRuntimeOptions {
  workingDir: string;
  timeoutMs?: number;
  events?: UniversalAgentEventBus;
  store?: ExecutionStore;
  executable?: string;
}

const PERMISSION_PATTERNS = [/allow .*\\?/i, /approve .*\\?/i, /permission/i, /do you want me to/i, /yes\\/no/i];
const AUTH_PATTERNS = [/api[_ -]?key/i, /authentication required/i, /log(?:in|in required)/i, /sign in/i, /unauthorized/i];
const QUESTION_PATTERNS = [/choose one/i, /select an option/i, /enter .*:/i, /\\?\\s*$/m];

export class UniversalAgentRuntime {
  private sessions = new Map<string, UniversalAgentSession>();
  private readonly store: ExecutionStore;

  constructor(private readonly definition: UniversalAgentDefinition, private readonly options: UniversalRuntimeOptions) {
    this.store = options.store ?? new ExecutionStore();
  }

  async createSession(request?: AgentRequest): Promise<UniversalAgentSession> {
    const launch = request
      ? createLaunchContract(this.definition, request, this.options.executable)
      : {
          executable: this.options.executable ?? this.definition.executableCandidates[0],
          args: [],
          promptDelivery: this.definition.promptDelivery ?? 'interactive-stdin',
          promptEnv: this.definition.promptEnv,
          interactive: true,
          headless: this.definition.capabilities.headless,
          supportsInterrupt: true,
          supportsResume: this.definition.capabilities.resumeSessions,
        };
    if (!launch.executable) throw new Error('No executable configured for ' + this.definition.id);

    const extraEnv = launch.promptDelivery === 'env' && launch.promptEnv && request?.prompt
      ? { [launch.promptEnv]: request.prompt }
      : {};
    const terminal = await getTerminalSessionManager().createSession(
      this.definition.id,
      launch.executable,
      launch.args,
      request?.workingDir || this.options.workingDir,
      request?.mode || 'execution',
      extraEnv,
    );
    const session: UniversalAgentSession = {
      id: nanoid(12),
      agentId: this.definition.id,
      terminalId: terminal.id,
      startedAt: Date.now(),
      status: terminal.status === 'running' ? 'running' : 'failed',
    };
    this.sessions.set(session.id, session);
    this.options.events?.emitEvent({ type: 'agent:session-started', agentId: session.agentId, sessionId: session.id, terminalId: session.terminalId, timestamp: Date.now() });
    this.options.events?.emitEvent({ type: 'agent:state-changed', agentId: session.agentId, sessionId: session.id, state: session.status === 'running' ? 'working' : 'failed', timestamp: Date.now() });
    return session;
  }

  async execute(request: AgentRequest): Promise<AgentResponse> {
    const startedAt = Date.now();
    const executionId = nanoid(16);
    const session = await this.createSession(request);
    const manager = getTerminalSessionManager();
    const launch = createLaunchContract(this.definition, request, this.options.executable);
    let output = '';
    let exitCode: number | undefined;
    let settled = false;

    await this.store.upsert({
      id: executionId,
      taskId: request.id,
      agentId: this.definition.id,
      sessionId: session.id,
      startedAt,
      status: 'running',
      prompt: request.prompt,
    });

    if (launch.promptDelivery === 'interactive-stdin' && request.prompt) {
      if (!manager.write(session.terminalId, request.prompt + '\n')) {
        return this.failureAndPersist(executionId, request, session, startedAt, 'Unable to write prompt to agent stdin', 'permission_denied', output);
      }
    }

    return await new Promise<AgentResponse>((resolve) => {
      const timeoutMs = request.timeoutMs || this.options.timeoutMs || 180000;
      let timer: ReturnType<typeof setTimeout>;

      const finish = async (
        response: AgentResponse,
        status: 'completed' | 'failed' | 'stopped' | 'recovering' = response.success ? 'completed' : 'failed',
      ) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        cleanup();
        session.status = status;
        await this.store.upsert({
          id: executionId,
          taskId: request.id,
          agentId: this.definition.id,
          sessionId: session.id,
          startedAt,
          finishedAt: Date.now(),
          status,
          prompt: request.prompt,
          response,
          evidence: {
            outputBytes: Buffer.byteLength(output),
            exitCode,
            validated: response.success,
          },
        });
        this.options.events?.emitEvent({ type: 'agent:state-changed', agentId: this.definition.id, sessionId: session.id, state: status, timestamp: Date.now() });
        this.options.events?.emitEvent(
          response.success
            ? { type: 'agent:completed', agentId: this.definition.id, sessionId: session.id, success: true, timestamp: Date.now() }
            : { type: 'agent:failed', agentId: this.definition.id, sessionId: session.id, error: response.error ?? 'agent failed', timestamp: Date.now() },
        );
        resolve(response);
      };

      const onOutput = (event: { sessionId: string; agentId: string; data: string }) => {
        if (event.sessionId !== session.terminalId) return;
        output += event.data;
        request.onOutput?.(event.data);
        this.options.events?.emitEvent({ type: 'agent:output', agentId: this.definition.id, sessionId: session.id, data: event.data, timestamp: Date.now() });

        if (AUTH_PATTERNS.some(pattern => pattern.test(event.data))) {
          this.options.events?.emitEvent({ type: 'agent:authentication-required', agentId: this.definition.id, sessionId: session.id, timestamp: Date.now() });
          this.options.events?.emitEvent({ type: 'agent:waiting', agentId: this.definition.id, sessionId: session.id, reason: 'authentication', prompt: event.data.trim(), timestamp: Date.now() });
          this.options.events?.emitEvent({ type: 'agent:state-changed', agentId: this.definition.id, sessionId: session.id, state: 'waiting', timestamp: Date.now() });
        } else if (PERMISSION_PATTERNS.some(pattern => pattern.test(event.data))) {
          this.options.events?.emitEvent({ type: 'agent:permission-requested', agentId: this.definition.id, sessionId: session.id, prompt: event.data.trim(), timestamp: Date.now() });
          this.options.events?.emitEvent({ type: 'agent:waiting', agentId: this.definition.id, sessionId: session.id, reason: 'permission', prompt: event.data.trim(), timestamp: Date.now() });
          this.options.events?.emitEvent({ type: 'agent:state-changed', agentId: this.definition.id, sessionId: session.id, state: 'waiting', timestamp: Date.now() });
        } else if (QUESTION_PATTERNS.some(pattern => pattern.test(event.data))) {
          this.options.events?.emitEvent({ type: 'agent:question-requested', agentId: this.definition.id, sessionId: session.id, prompt: event.data.trim(), timestamp: Date.now() });
          this.options.events?.emitEvent({ type: 'agent:waiting', agentId: this.definition.id, sessionId: session.id, reason: 'question', prompt: event.data.trim(), timestamp: Date.now() });
          this.options.events?.emitEvent({ type: 'agent:state-changed', agentId: this.definition.id, sessionId: session.id, state: 'waiting', timestamp: Date.now() });
        }
      };

      const onExit = (event: { sessionId: string; agentId: string; exitCode: number }) => {
        if (event.sessionId !== session.terminalId) return;
        exitCode = event.exitCode;
        void finish({
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
        void finish(this.failure(event.error, 'crash', startedAt, output));
      };

      const cleanup = () => {
        manager.off('session:output', onOutput);
        manager.off('session:failed', onFailed);
        manager.off('session:exited', onExit);
      };

      manager.on('session:output', onOutput);
      manager.on('session:failed', onFailed);
      manager.on('session:exited', onExit);

      timer = setTimeout(() => {
        void this.store.checkpoint(executionId, output);
        this.options.events?.emitEvent({ type: 'agent:state-changed', agentId: this.definition.id, sessionId: session.id, state: 'recovering', timestamp: Date.now() });
        this.options.events?.emitEvent({ type: 'agent:recovery-requested', agentId: this.definition.id, sessionId: session.id, reason: 'execution timeout', timestamp: Date.now() });
        void manager.stopSession(session.terminalId);
        void finish(this.failure('Agent execution timed out', 'timeout', startedAt, output), 'recovering');
      }, timeoutMs);
    });
  }

  sendInput(sessionId: string, input: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    return getTerminalSessionManager().write(session.terminalId, input);
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

  private async failureAndPersist(
    executionId: string,
    request: AgentRequest,
    session: UniversalAgentSession,
    startedAt: number,
    error: string,
    errorType: AgentResponse['errorType'],
    output: string,
  ): Promise<AgentResponse> {
    await getTerminalSessionManager().stopSession(session.terminalId);
    session.status = 'failed';
    const response = this.failure(error, errorType, startedAt, output);
    await this.store.upsert({
      id: executionId,
      taskId: request.id,
      agentId: this.definition.id,
      sessionId: session.id,
      startedAt,
      finishedAt: Date.now(),
      status: 'failed',
      prompt: request.prompt,
      response,
      evidence: { outputBytes: Buffer.byteLength(output), validated: false },
    });
    return response;
  }

  private failure(error: string, errorType: AgentResponse['errorType'], startedAt: number, output = ''): AgentResponse {
    return {
      agentId: this.definition.id,
      success: false,
      content: output,
      fileChanges: [],
      rawOutput: output,
      error,
      errorType,
      durationMs: Date.now() - startedAt,
    };
  }
}
