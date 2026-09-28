import type { AppModel } from './model.js';
import { initialModel } from './model.js';
import { update } from './update.js';
import type { Msg } from './update.js';
import { buildFrame } from './view.js';
import { enterFullScreen, exitFullScreen, getTerminalSize, writeFrame, installCrashRecovery, onResize } from './terminal/surface.js';
import { startInput } from './terminal/input.js';
import type { KeyEvent } from './terminal/input.js';
import { tickSpin } from './theme.js';
import { startConsoleCapture, stopConsoleCapture, drainCapturedLogs } from './services/consoleCapture.js';
import { runAgentDetection, assignCallsigns } from './services/agentDetection.js';
import { runSession } from './services/sessionBridge.js';
import { readGitHubState } from './services/gitHubState.js';

const VALID_STRATEGIES = ['single', 'single-fallback', 'fallback', 'swarm', 'manual'];

export function normalizeStrategyForSession(s: string): string {
  return VALID_STRATEGIES.includes(s) ? s : 'single-fallback';
}

export class EamilOSTuiApp {
  private model: AppModel;
  private frameInterval: ReturnType<typeof setInterval> | null = null;
  private logInterval: ReturnType<typeof setInterval> | null = null;
  private stopInput: (() => void) | null = null;
  private stopResize: (() => void) | null = null;
  private running = false;

  constructor() {
    const size = getTerminalSize();
    this.model = initialModel(size.width, size.height);
  }

  private dispatch(msg: Msg): void {
    this.model = update(this.model, msg);
  }

  private getModel(): AppModel {
    return this.model;
  }

  private onLog(text: string): void {
    this.dispatch({ type: 'LOG', text });
  }

  async start(): Promise<void> {
    startConsoleCapture();
    enterFullScreen();
    installCrashRecovery();

    this.stopResize = onResize((size) => {
      this.dispatch({ type: 'RESIZE', width: size.width, height: size.height });
    });

    this.stopInput = startInput((event: KeyEvent) => this.handleKey(event));

    this.frameInterval = setInterval(() => this.renderFrame(), 50);
    this.logInterval = setInterval(() => {
      for (const log of drainCapturedLogs()) this.dispatch({ type: 'LOG', text: log });
    }, 250);

    this.dispatch({ type: 'DETECTION_START' });
    try {
      const rawAgents = await runAgentDetection();
      this.dispatch({ type: 'DETECTION_COMPLETE', agents: assignCallsigns(rawAgents) });
    } catch (err) {
      this.dispatch({ type: 'DETECTION_FAILED', error: err instanceof Error ? err.message : String(err) });
    }
    this.renderFrame();
  }

  private handleKey(event: KeyEvent): void {
    switch (event.type) {
      case 'char': {
        if (this.model.running && !['x','m','f','r','l','d','p'].includes(event.char.toLowerCase())) break;
        const pages: Record<string, AppModel['page']> = {
          m: 'mission',
          x: 'execution',
          t: 'tasks',
          a: 'artifacts',
          s: 'sessions',
          g: 'github',
          f: 'fleet',
          r: 'graph',
          l: 'loop',
          d: 'decisions',
          p: 'approvals',
          c: 'chat',
          l: 'logs',
        };
        const page = pages[event.char.toLowerCase()];
        if (page) {
          if (page === 'execution') this.dispatch({ type: 'TOGGLE_ACTIVITY_FOLLOW' });
          if (page === 'github') {
            this.dispatch({ type: 'REFRESH_GITHUB' });
            void readGitHubState().then(state => this.dispatch({ type: 'GITHUB_REFRESHED', state }));
          }
          this.dispatch({ type: 'SET_PAGE', page });
        } else if (!this.model.running) {
          this.dispatch({ type: 'INPUT_CHAR', char: event.char });
        }
        break;
      }

      case 'enter': {
        if (this.model.page === 'graph') {
          const node = this.model.graph.nodes.find(n => n.id === this.model.graph.focus.nodeId) ?? this.model.graph.nodes[0];
          if (node) this.dispatch({ type: 'GRAPH_FOCUS', nodeId: node.id });
          break;
        }
        if (this.model.running) break;
        const prompt = this.model.input.trim();
        if (!prompt) break;
        this.dispatch({ type: 'INPUT_CLEAR' });
        this.startSession(prompt);
        break;
      }

      case 'backspace': this.dispatch({ type: 'INPUT_BACKSPACE' }); break;
      case 'escape': this.stop(); break;

      case 'ctrl':
        if (event.key === 'c') {
          if (this.model.running) this.cancelSession();
          else this.stop();
        } else if (event.key === 's') this.dispatch({ type: 'TOGGLE_SIDEBAR' });
        else if (event.key === 'l') this.dispatch({ type: 'CLEAR_CHAT' });
        else if (event.key === 'p') this.dispatch({ type: 'INPUT_RECALL' });
        break;

      case 'tab': {
        const strats = ['single', 'single-fallback', 'fallback', 'swarm', 'manual'] as const;
        const idx = strats.indexOf(this.model.strategy);
        this.dispatch({ type: 'SET_STRATEGY', strategy: strats[(idx + 1) % strats.length]! });
        break;
      }

      case 'char': {
        if (this.model.page === 'graph') { const node=this.model.graph.focus.nodeId; if(node) this.dispatch({type:'GRAPH_TOGGLE_EXPAND',nodeId:node}); }
        break;
      }
      case 'left': {
        if (this.model.page === 'graph') { const node=this.model.graph.focus.nodeId; if(node) this.dispatch({type:'GRAPH_TOGGLE_EXPAND',nodeId:node}); }
        break;
      }
      case 'pageup': this.dispatch({ type: 'SCROLL_UP', lines: 10 }); break;
      case 'pagedown': this.dispatch({ type: 'SCROLL_DOWN', lines: 10 }); break;
      case 'up': {
        if (this.model.page === 'decisions') { const rs=this.model.decisions.records; if(rs.length){const i=Math.max(0,rs.findIndex(d=>d.id===this.model.decisions.selectedDecisionId));this.dispatch({type:'SELECT_DECISION',decisionId:rs[Math.max(0,i-1)]!.id});} }
        else if (this.model.page === 'approvals') { const rs=this.model.approvals.requests; if(rs.length){const i=Math.max(0,rs.findIndex(a=>a.id===this.model.approvals.selectedApprovalId));this.dispatch({type:'SELECT_APPROVAL',approvalId:rs[Math.max(0,i-1)]!.id});} }
        else if (this.model.page === 'graph') { const nodes=this.model.graph.nodes; if(nodes.length){const i=Math.max(0,nodes.findIndex(n=>n.id===this.model.graph.focus.nodeId));const next=nodes[Math.max(0,i-1)]!;this.dispatch({type:'GRAPH_FOCUS',nodeId:next.id});} }
        else if (this.model.page === 'fleet') { const agents=this.model.fleet.agents; if(agents.length){const i=Math.max(0,agents.findIndex(a=>a.id===this.model.fleet.selectedAgentId));this.dispatch({type:'FLEET_SELECT_AGENT',agentId:agents[Math.max(0,i-1)]!.id});} }
        else this.dispatch({ type: 'SCROLL_UP', lines: 1 }); break;
      }
      case 'down': {
        if (this.model.page === 'decisions') { const rs=this.model.decisions.records; if(rs.length){const i=Math.max(0,rs.findIndex(d=>d.id===this.model.decisions.selectedDecisionId));this.dispatch({type:'SELECT_DECISION',decisionId:rs[Math.min(rs.length-1,i+1)]!.id});} }
        else if (this.model.page === 'approvals') { const rs=this.model.approvals.requests; if(rs.length){const i=Math.max(0,rs.findIndex(a=>a.id===this.model.approvals.selectedApprovalId));this.dispatch({type:'SELECT_APPROVAL',approvalId:rs[Math.min(rs.length-1,i+1)]!.id});} }
        else if (this.model.page === 'graph') { const nodes=this.model.graph.nodes; if(nodes.length){const i=Math.max(0,nodes.findIndex(n=>n.id===this.model.graph.focus.nodeId));const next=nodes[Math.min(nodes.length-1,i+1)]!;this.dispatch({type:'GRAPH_FOCUS',nodeId:next.id});} }
        else if (this.model.page === 'fleet') { const agents=this.model.fleet.agents; if(agents.length){const i=Math.max(0,agents.findIndex(a=>a.id===this.model.fleet.selectedAgentId));this.dispatch({type:'FLEET_SELECT_AGENT',agentId:agents[Math.min(agents.length-1,i+1)]!.id});} }
        else this.dispatch({ type: 'SCROLL_DOWN', lines: 1 }); break;
      }
 else this.dispatch({ type: 'SCROLL_DOWN', lines: 1 }); break;
      }
    }
  }

  private async startSession(prompt: string): Promise<void> {
    if (this.running) return;
    this.running = true;
    const agents = Array.from(this.model.agents.values()).filter(a => a.status === 'ready');
    const mode = agents.some(a => a.id === 'opencode' || a.id === 'claude-code' || a.id === 'aider') ? 'execution' : 'communication';
    this.dispatch({ type: 'STATUS_TEXT', text: 'Starting mission…' });

    try {
      await runSession(prompt, this.model.strategy, mode, {
        dispatch: (msg) => this.dispatch(msg),
        getModel: () => this.getModel(),
        onLog: (text) => this.onLog(text),
      });
    } finally {
      this.running = false;
    }
  }

  private cancelSession(): void {
    this.dispatch({ type: 'SESSION_ERROR', error: 'Cancelled by user' });
  }

  private renderFrame(): void {
    this.dispatch({ type: 'TICK' });
    writeFrame(buildFrame(this.model));
  }

  stop(): void {
    if (this.frameInterval) { clearInterval(this.frameInterval); this.frameInterval = null; }
    if (this.logInterval) { clearInterval(this.logInterval); this.logInterval = null; }
    if (this.stopInput) { this.stopInput(); this.stopInput = null; }
    if (this.stopResize) { this.stopResize(); this.stopResize = null; }
    stopConsoleCapture();
    exitFullScreen();
    process.exit(0);
  }
}
