import type { TuiState, TuiMessage, AgentUiInfo, LogEntry, TerminalInfo, GraphStats, SessionSummary, PageId, StrategyId, DetectionState } from './types.js';
import { TerminalSurface } from './terminal.js';
import { render } from './render.js';
import { AgentRegistry } from '../core/agents/AgentRegistry.js';
import { createSessionOrchestrator } from '../core/session/SessionOrchestrator.js';
import type { SessionOrchestrator } from '../core/session/SessionOrchestrator.js';
import type { SessionEventMap } from '../core/session/events.js';

const VALID_STRATEGIES: StrategyId[] = ['single', 'single-fallback', 'fallback', 'swarm', 'manual'];

export function normalizeStrategyForSession(s: string): StrategyId {
  if (VALID_STRATEGIES.includes(s as StrategyId)) return s as StrategyId;
  return 'single-fallback';
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export class EamilOSTuiApp {
  private term: TerminalSurface;
  private state: TuiState;
  private frameInterval: ReturnType<typeof setInterval> | null = null;
  private logPollInterval: ReturnType<typeof setInterval> | null = null;
  private activeSession: SessionOrchestrator | null = null;
  private agentRegistry: AgentRegistry | null = null;
  private abortRef = false;
  private streamingMessageIds = new Map<string, string>();
  private currentStartTime = 0;

  constructor(term: TerminalSurface) {
    this.term = term;
    this.state = this.createInitialState();
  }

  private createInitialState(): TuiState {
    return {
      detectionState: 'idle' as DetectionState,
      agents: [],
      messages: [],
      logs: [],
      terminals: [],
      graph: { nodes: 0, edges: 0, validated: false },
      modifiedFiles: [],
      sessions: [],
      inputValue: '',
      activePage: 'chat' as PageId,
      strategy: 'single-fallback' as StrategyId,
      isRunning: false,
      sidebarVisible: true,
      statusMessage: '',
      terminalWidth: this.term.cols,
      terminalHeight: this.term.rows,
      errorCount: 0,
      warnCount: 0,
    };
  }

  private addMessage(opts: Partial<TuiMessage> & { content: string }): void {
    const msg: TuiMessage = {
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now(),
      content: opts.content,
      agentId: opts.agentId,
      isStreaming: opts.isStreaming ?? false,
      isUser: opts.isUser ?? false,
      isSystem: opts.isSystem ?? false,
      isError: opts.isError ?? false,
    };
    this.state.messages.push(msg);
  }

  private addLog(level: string, message: string): void {
    this.state.logs.push({ timestamp: Date.now(), level, message });
  }

  private updateOrAddAgent(agent: Partial<AgentUiInfo> & { id: string }): void {
    const idx = this.state.agents.findIndex(a => a.id === agent.id);
    if (idx >= 0) {
      this.state.agents[idx] = { ...this.state.agents[idx], ...agent };
    } else {
      this.state.agents.push(agent as AgentUiInfo);
    }
  }

  private appendAgentOutput(agentId: string, chunk: string): void {
    const existingId = this.streamingMessageIds.get(agentId);
    if (existingId) {
      const msg = this.state.messages.find(m => m.id === existingId);
      if (msg) {
        msg.content += chunk;
        return;
      }
    }
    const id = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.state.messages.push({
      id,
      timestamp: Date.now(),
      agentId,
      content: chunk,
      isStreaming: true,
      isUser: false,
      isSystem: false,
      isError: false,
    });
    this.streamingMessageIds.set(agentId, id);
  }

  private markAgentOutputComplete(agentId: string): void {
    const id = this.streamingMessageIds.get(agentId);
    if (id) {
      const msg = this.state.messages.find(m => m.id === id);
      if (msg) msg.isStreaming = false;
      this.streamingMessageIds.delete(agentId);
    }
  }

  async start(): Promise<void> {
    this.term.enterAltScreen();
    this.term.enableRawMode();
    this.term.captureConsole();
    this.term.bindProcessExit();

    this.term.onResize((cols, rows) => {
      this.state.terminalWidth = cols;
      this.state.terminalHeight = rows;
    });

    this.term.onKey((key) => this.handleKey(key));

    this.state.detectionState = 'detecting';
    this.addLog('INFO', 'Detecting available agents...');
    this.agentRegistry = await this.detectAgents();

    this.frameInterval = setInterval(() => this.renderFrame(), 50);
    this.logPollInterval = setInterval(() => this.pollLogs(), 250);

    this.renderFrame();
  }

  private async detectAgents(): Promise<AgentRegistry> {
    try {
      const registry = AgentRegistry.create();
      await registry.detect();
      const allAgents = registry.getAllAgents();

      for (const agent of allAgents) {
        this.updateOrAddAgent({
          id: agent.id,
          name: agent.name,
          status: agent.status === 'available' ? 'available' : 'offline',
          kind: agent.kind,
          provider: agent.provider,
          version: agent.version,
          error: agent.error,
        });
      }

      const available = registry.getAvailableAgents();
      this.addLog('INFO', `Detected ${available.length} available agents`);

      for (const a of available) {
        this.state.terminals.push({
          callsign: a.id.toUpperCase().slice(0, 4),
          agentId: a.id,
          status: 'ready',
          mode: a.supportedModes.includes('execution') ? 'execution' : 'communication',
        });
      }

      this.state.detectionState = 'complete';
      return registry;
    } catch (err) {
      this.state.detectionState = 'failed';
      const msg = err instanceof Error ? err.message : String(err);
      this.addLog('ERROR', `Agent detection failed: ${msg}`);
      return AgentRegistry.create();
    }
  }

  private pollLogs(): void {
    const captured = this.term.capturedLogs;
    while (captured.length > 0) {
      const entry = captured.shift();
      if (entry) {
        this.state.statusMessage = entry.slice(0, 100);
      }
    }
  }

  private renderFrame(): void {
    const frame = render(this.state);
    this.term.clear();
    this.term.write(frame);
  }

  private handleKey(key: string): void {
    if (key === '\x1b') {
      this.cleanupAndExit();
      return;
    }

    if (key === '\x03') {
      if (this.state.isRunning) {
        this.cancelSession();
      } else {
        this.cleanupAndExit();
      }
      return;
    }

    if (key === '\r' || key === '\n') {
      if (this.state.inputValue.trim() && !this.state.isRunning) {
        const prompt = this.state.inputValue.trim();
        this.state.inputValue = '';
        this.runSession(prompt);
      }
      return;
    }

    if (key === '\x7f') {
      this.state.inputValue = this.state.inputValue.slice(0, -1);
      return;
    }

    if (key === '\t') {
      this.state.sidebarVisible = !this.state.sidebarVisible;
      return;
    }

    if (key === '\x13') {
      this.state.sidebarVisible = !this.state.sidebarVisible;
      return;
    }

    if (key === '\x0c') {
      this.state.messages = [];
      this.state.modifiedFiles = [];
      this.state.graph = { nodes: 0, edges: 0, validated: false };
      this.state.errorCount = 0;
      this.state.warnCount = 0;
      return;
    }

    if (key >= '1' && key <= '5') {
      const pages: PageId[] = ['chat', 'logs', 'agents', 'sessions', 'terminals'];
      this.state.activePage = pages[parseInt(key) - 1]!;
      return;
    }

    if (key === '!') { this.state.strategy = 'single'; return; }
    if (key === '@') { this.state.strategy = 'single-fallback'; return; }
    if (key === '#') { this.state.strategy = 'fallback'; return; }
    if (key === '$') { this.state.strategy = 'swarm'; return; }
    if (key === '%') { this.state.strategy = 'manual'; return; }

    if (key === '\x1b[A') {
      return;
    }

    if (key === '\x1b[B') {
      return;
    }

    if (key.length === 1 && key.charCodeAt(0) >= 32) {
      this.state.inputValue += key;
    }
  }

  private async runSession(prompt: string): Promise<void> {
    if (this.state.isRunning) return;
    this.abortRef = false;
    this.currentStartTime = Date.now();

    this.state.isRunning = true;
    this.state.graph = { nodes: 0, edges: 0, validated: false };

    this.addMessage({ content: prompt, isUser: true });
    this.addMessage({ content: `Strategy: ${this.state.strategy} -- Running...`, isSystem: true });

    if (!this.agentRegistry) {
      this.agentRegistry = AgentRegistry.create();
    }

    const available = this.agentRegistry.getAvailableAgents();
    if (available.length === 0) {
      this.addMessage({ content: 'No agents available. Install opencode-ai, claude-code, or set API keys and restart.', isError: true });
      this.state.isRunning = false;
      return;
    }

    const session = createSessionOrchestrator({
      goal: prompt,
      projectId: `tui_${Date.now()}`,
      strategy: normalizeStrategyForSession(this.state.strategy),
      mode: available.some(a => a.supportedModes.includes('execution')) ? 'execution' : 'communication',
      workingDir: process.cwd(),
      maxRetries: 2,
      timeoutMs: 120000,
    });
    this.activeSession = session;

    session.on('agent.started', (data) => {
      this.updateOrAddAgent({ id: data.agentId, status: 'busy' });
    });

    session.on('agent.output', (data) => {
      if (this.abortRef) return;
      this.appendAgentOutput(data.agentId, data.content);
    });

    session.on('agent.completed', (data) => {
      this.updateOrAddAgent({ id: data.agentId, status: 'available' });
      this.markAgentOutputComplete(data.agentId);
    });

    session.on('agent.error', (data) => {
      this.updateOrAddAgent({ id: data.agentId, status: 'failed' });
      this.markAgentOutputComplete(data.agentId);
      this.addMessage({ content: `[${data.agentId}] ${data.error}`, isError: true });
    });

    session.on('agent.fallback', (data) => {
      this.updateOrAddAgent({ id: data.from, status: 'failed' });
      this.updateOrAddAgent({ id: data.to, status: 'busy' });
      this.addMessage({ content: `Fallback: ${data.from} → ${data.to} (${data.reason})`, isSystem: true });
    });

    session.on('validation.passed', () => {
      this.state.graph.validated = true;
    });

    session.on('validation.failed', (data) => {
      this.state.graph.validated = false;
      this.state.errorCount = data.errors.length;
      for (const err of data.errors) {
        this.addMessage({ content: `Validation: ${err}`, isError: true });
      }
    });

    session.on('changes.collected', (data) => {
      this.state.graph.nodes = data.changes?.length || 0;
      this.state.graph.edges = data.changes?.length || 0;
      for (const change of data.changes ?? []) {
        this.state.modifiedFiles.push({
          path: change.path,
          action: change.action === 'deleted' ? 'delete' : change.action === 'modified' ? 'modify' : 'create',
          status: 'pending',
          agentId: change.agentId,
        });
      }
    });

    session.on('changes.applied', (data) => {
      for (const p of data.applied) {
        const file = this.state.modifiedFiles.find(f => f.path === p);
        if (file) file.status = 'applied';
      }
      for (const f of data.failed) {
        const file = this.state.modifiedFiles.find(mf => mf.path === f.path);
        if (file) file.status = 'failed';
      }
    });

    session.on('session.completed', (data) => {
      this.state.graph.validated = data.success;
    });

    session.on('session.error', (data) => {
      this.addMessage({ content: `Session error: ${data.error}`, isError: true });
    });

    try {
      const result = await session.run();
      const duration = Date.now() - this.currentStartTime;

      if (result.primaryResult) {
        this.addMessage({
          content: result.primaryResult,
          agentId: result.agentUsed || 'EamilOS',
          isSystem: false,
          isUser: false,
        });
      }

      this.state.graph = {
        nodes: result.fileChanges?.length || 0,
        edges: result.fileChanges?.length || 0,
        validated: result.success && result.errors.length === 0,
      };

      if (result.errors.length > 0) {
        this.state.errorCount = result.errors.length;
        for (const err of result.errors) {
          this.addMessage({ content: err, isError: true });
        }
      }

      this.state.sessions.push({
        id: `session_${this.currentStartTime}`,
        goal: prompt,
        strategy: normalizeStrategyForSession(this.state.strategy),
        startedAt: this.currentStartTime,
        status: result.success ? 'completed' : 'failed',
        messageCount: this.state.messages.length,
      });

      this.addLog('INFO', `Session ${result.success ? 'completed' : 'failed'} in ${formatDuration(duration)}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.addMessage({ content: `Execution failed: ${msg}`, isError: true });
      this.addLog('ERROR', `Session error: ${msg}`);
    } finally {
      this.state.isRunning = false;
      this.activeSession = null;
    }
  }

  private cancelSession(): void {
    this.abortRef = true;
    if (this.activeSession) {
      this.activeSession.stop().catch(() => {});
      this.activeSession = null;
    }
    this.state.isRunning = false;
    this.addMessage({ content: 'Execution cancelled by user.', isSystem: true });
  }

  private cleanupAndExit(): void {
    if (this.frameInterval) {
      clearInterval(this.frameInterval);
      this.frameInterval = null;
    }
    if (this.logPollInterval) {
      clearInterval(this.logPollInterval);
      this.logPollInterval = null;
    }
    this.term.restoreConsole();
    this.term.disableRawMode();
    this.term.exitAltScreen();
    process.exit(0);
  }

  stop(): void {
    this.cleanupAndExit();
  }
}
