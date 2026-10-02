import { nanoid } from 'nanoid';
import { getTerminalSessionManager } from '../../terminal/TerminalSessionManager.js';
import type { AgentRequest, AgentResponse } from '../types.js';
import type { UniversalAgentDefinition, UniversalAgentSession } from './types.js';
import type { UniversalAgentEventBus } from './AgentEventBus.js';
import { createLaunchContract } from './AgentLaunchContract.js';
import { ExecutionStore } from './ExecutionStore.js';

export interface UniversalRuntimeOptions {
  workingDir: string; timeoutMs?: number; events?: UniversalAgentEventBus; store?: ExecutionStore;
}

const PERMISSION_PATTERNS = [/allow .*\?/i, /approve .*\?/i, /permission/i, /do you want me to/i];
const QUESTION_PATTERNS = [/\?\s*$/m, /choose one/i, /select an option/i];

export class UniversalAgentRuntime {
  private sessions = new Map<string, UniversalAgentSession>();
  private readonly store: ExecutionStore;

  constructor(private readonly definition: UniversalAgentDefinition, private readonly options: UniversalRuntimeOptions) {
    this.store = options.store ?? new ExecutionStore();
  }

  async createSession(request?: AgentRequest): Promise<UniversalAgentSession> {
    const command = this.definition.executableCandidates[0];
    if (!command) throw new Error('No executable configured for ' + this.definition.id);
    const launch = request ? createLaunchContract(this.definition, request) : {
      executable: command, args: [], promptDelivery: this.definition.promptDelivery ?? 'interactive-stdin',
      interactive: true, headless: this.definition.capabilities.headless, supportsInterrupt: true, supportsResume: this.definition.capabilities.resumeSessions,
    };
    const terminal = await getTerminalSessionManager().createSession(this.definition.id, launch.executable, launch.args, request?.workingDir || this.options.workingDir, request?.mode || 'execution');
    const session: UniversalAgentSession = {
      id: nanoid(12), agentId: this.definition.id, terminalId: terminal.id, startedAt: Date.now(),
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
    const launch = createLaunchContract(this.definition, request);
    let output = '';
    let settled = false;
    await this.store.upsert({ id: executionId, taskId: request.id, agentId: this.definition.id, sessionId: session.id, startedAt, status: 'running', prompt: request.prompt });

    if (launch.promptDelivery === 'interactive-stdin' && request.prompt) manager.write(session.terminalId, request.prompt + '\n');
    else if (launch.promptDelivery === 'env' && launch.promptEnv) manager.write(session.terminalId, '');
    
    return await new Promise<AgentResponse>((resolve) => {
      const timeoutMs = request.timeoutMs || this.options.timeoutMs || 180000;
      const finish = async (response: AgentResponse, status: 'completed'|'failed'|'stopped' = response.success ? 'completed' : 'failed') => {
        if (settled) return;
        settled = true; clearTimeout(timer); cleanup();
        session.status = status;
        await this.store.upsert({ id: executionId, taskId: request.id, agentId: this.definition.id, sessionId: session.id, startedAt, finishedAt: Date.now(), status, prompt: request.prompt, response, evidence: { outputBytes: Buffer.byteLength(output), validated: response.success } });
        this.options.events?.emitEvent({ type: 'agent:state-changed', agentId: this.definition.id, sessionId: session.id, state: status, timestamp: Date.now() });
        this.options.events?.emitEvent(response.success
          ? { type: 'agent:completed', agentId: this.definition.id, sessionId: session.id, success: true, timestamp: Date.now() }
          : { type: 'agent:failed', agentId: this.definition.id, sessionId: session.id, error: response.error ?? 'agent failed', timestamp: Date.now() });
        resolve(response);
      };
      const onOutput = (event: { sessionId: string; agentId: string; data: string }) => {
        if (event.sessionId !== session.terminalId) return;
        output += event.data;
        request.onOutput?.(event.data);
        this.options.events?.emitEvent({ type: 'agent:output', agentId: this.definition.id, sessionId: session.id, data: event.data, timestamp: Date.now() });
        if (PERMISSION_PATTERNS.some(pattern => pattern.test(event.data))) {
          this.options.events?.emitEvent({ type: 'agent:permission-requested', agentId: this.definition.id, sessionId: session.id, prompt: event.data.trim(), timestamp: Date.now() });
          this.options.events?.emitEvent({ type: 'agent:waiting', agentId: this.definition.id, sessionId: session.id, reason: 'permission', prompt: event.data.trim(), timestamp: Date.now() });
          this.options.events?.emitEvent({ type: 'agent:state-changed', agentId: this.definition.id, sessionId: session.id, state: 'waiting', timestamp: Date.now() });
        } else if (QUESTION_PATTERNS.some(pattern => pattern.test(event.data))) {
          this.options.events?.emitEvent({ type: 'agent:question-requested', agentId: this.definition.id, sessionId: session.id, prompt: event.data.trim(), timestamp: Date.now() });
          this.options.events?.emitEvent({ type: 'agent:waiting', agentId: this.definition.id, sessionId: session.id, reason: 'question', prompt: event.data.trim(), timestamp: Date.now() });
        }
      };
      const onExit = (event: { sessionId: string; agentId: string; exitCode: number }) => {
        if (event.sessionId !== session.terminalId) return;
        void finish({ agentId: this.definition.id, success: event.exitCode === 0, content: output, fileChanges: [], rawOutput: output, error: event.exitCode === 0 ? undefined : output || 'Agent exited with code ' + event.exitCode, errorType: event.exitCode === 0 ? undefined : 'unknown', durationMs: Date.now() - startedAt });
      };
      const onFailed = (event: { sessionId: string; agentId: string; error: string }) => {
        if (event.sessionId !== session.terminalId) return;
        void finish(this.failure(event.error, 'crash', startedAt, output));
      };
      const cleanup = () => {
        manager.off('session:output', onOutput); manager.off('session:exited', onExit); manager.off('session:failed', onFailed);
      };
      manager.on('session:output', onOutput); manager.on('session:exited', onExit); manager.on('session:failed', onFailed);
      const timer = setTimeout(() => {
        void this.store.checkpoint(executionId, output);
        void manager.stopSession(session.terminalId);
        this.options.events?.emitEvent({ type: 'agent:recovery-requested', agentId: this.definition.id, sessionId: session.id, reason: 'execution timeout', timestamp: Date.now() });
        void finish(this.failure('Agent execution timed out', 'timeout', startedAt, output));
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

  private failure(error: string, errorType: AgentResponse['errorType'], startedAt: number, output = ''): AgentResponse {
    return { agentId: this.definition.id, success: false, content: output, fileChanges: [], rawOutput: output, error, errorType, durationMs: Date.now() - startedAt };
  }
}
