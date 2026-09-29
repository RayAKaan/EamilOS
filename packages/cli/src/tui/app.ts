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
import { paletteOpen, paletteClose, paletteInput, paletteBackspace, paletteMove } from './palette.js';
import { commandMatches } from './commands/registry.js';
import { executeSlashCommand, isSlashCommand, isShellEscape } from './commands/input.js';

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
  private renderScheduled = false;

  constructor() {
    const size = getTerminalSize();
    this.model = initialModel(size.width, size.height);
  }

  private dispatch(msg: Msg): void {
    this.model = update(this.model, msg);
    if (this.model.renderRequested) {
      this.scheduleRender();
    }
  }

  private getModel(): AppModel {
    return this.model;
  }

  private onLog(text: string): void {
    this.dispatch({ type: 'LOG', text });
  }

  private scheduleRender(): void {
    if (this.renderScheduled) return;
    this.renderScheduled = true;
    queueMicrotask(() => {
      this.renderScheduled = false;
      this.model = update(this.model, { type: 'REQUEST_RENDER' });
      this.renderFrame();
    });
  }

  private requestRender(): void {
    this.dispatch({ type: 'REQUEST_RENDER' });
  }

  async start(): Promise<void> {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      this.dispatch({ type: 'SET_NOTIFICATION', text: 'Interactive TUI requires a TTY; use the non-interactive CLI/JSON interface instead.' });
      this.dispatch({ type: 'SET_APPLICATION_STATE', state: 'stopped' });
      return;
    }
    startConsoleCapture();
    enterFullScreen();
    installCrashRecovery();

    this.dispatch({ type: 'SET_APPLICATION_STATE', state: 'ready' });

    this.stopResize = onResize((size) => {
      this.dispatch({ type: 'RESIZE', width: size.width, height: size.height });
    });

    this.stopInput = startInput((event: KeyEvent) => this.handleKey(event));

    this.frameInterval = setInterval(() => {
      this.dispatch({ type: 'TICK' });
      this.scheduleRender();
    }, 50);

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
    this.dispatch({ type: 'SET_APPLICATION_STATE', state: 'ready' });
    this.scheduleRender();
  }

  private handleKey(event: KeyEvent): void {
    switch (event.type) {
      case 'char': {
        if (this.model.commandPalette.open) {
          this.dispatch({ type: 'COMMAND_PALETTE_INPUT', char: event.char });
          break;
        }
        if (event.char === '?' && !this.model.running) {
          this.dispatch({ type: 'SET_NOTIFICATION', text: 'Ctrl+P command palette · / commands · ↑↓ navigate · Enter select · Esc back' });
          break;
        }
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
          z: 'logs',
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
        if (this.model.commandPalette.open) { this.dispatch({ type: 'COMMAND_PALETTE_EXECUTE' }); break; }
        if (this.model.page === 'decisions') {
          const id=this.model.decisions.selectedDecisionId;
          if(id) this.dispatch({type:'SELECT_DECISION',decisionId:id});
          break;
        }
        if (this.model.page === 'approvals') {
          const id=this.model.approvals.selectedApprovalId;
          if(id) this.dispatch({type:'SELECT_APPROVAL',approvalId:id});
          break;
        }
        if (this.model.page === 'graph') {
          const node = this.model.graph.nodes.find(n => n.id === this.model.graph.focus.nodeId) ?? this.model.graph.nodes[0];
          if (node) this.dispatch({ type: 'GRAPH_FOCUS', nodeId: node.id });
          break;
        }
        if (this.model.running) break;
        const prompt = this.model.input.trim();
        if (!prompt) break;
        if (isShellEscape(prompt)) {
          this.dispatch({type:'SET_NOTIFICATION',text:'Shell escape is intentionally disabled in the mission TUI. Use an explicit terminal command outside the mission prompt.'});
          break;
        }
        if (isSlashCommand(prompt)) {
          const effect=executeSlashCommand(this.model,prompt);
          if(effect?.type==='page') this.dispatch({type:'SET_PAGE',page:effect.page});
          else if(effect?.type==='message') this.dispatch({type:'SET_NOTIFICATION',text:effect.text});
          else if(!effect) this.dispatch({type:'SET_NOTIFICATION',text:'Unknown command. Press Ctrl+P to search available commands.'});
          this.dispatch({type:'INPUT_CLEAR'});
          break;
        }
        this.dispatch({ type: 'INPUT_CLEAR' });
        this.startSession(prompt);
        break;
      }

      case 'backspace': if(this.model.commandPalette.open)this.dispatch({type:'COMMAND_PALETTE_BACKSPACE'}); else this.dispatch({ type: 'INPUT_BACKSPACE' }); break;
      case 'escape': if(this.model.commandPalette.open){this.dispatch({type:'COMMAND_PALETTE_CLOSE'});break;} this.handleEscape(); break;

      case 'ctrl':
        if (event.key === 'p') { this.dispatch({ type: 'COMMAND_PALETTE_OPEN' }); break; }
        if (event.key === 'c') {
          this.handleCtrlC();
          break;
        } else if (event.key === 's') this.dispatch({ type: 'TOGGLE_SIDEBAR' });
        else if (event.key === 'l') this.dispatch({ type: 'CLEAR_CHAT' });
        else if (event.key === 'p') this.dispatch({ type: 'INPUT_RECALL' });
        else if (event.key === 'q') this.requestShutdown();
        break;

      case 'tab': {
        const strats = ['single', 'single-fallback', 'fallback', 'swarm', 'manual'] as const;
        const idx = strats.indexOf(this.model.strategy);
        this.dispatch({ type: 'SET_STRATEGY', strategy: strats[(idx + 1) % strats.length]! });
        break;
      }

      case 'right': {
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
        if (this.model.commandPalette.open) { this.dispatch({type:'COMMAND_PALETTE_MOVE',delta:-1}); break; }
        if (this.model.page === 'decisions') {
          const rs=this.model.decisions.records;if(rs.length){const i=Math.max(0,rs.findIndex(d=>d.id===this.model.decisions.selectedDecisionId));this.dispatch({type:'SELECT_DECISION',decisionId:rs[Math.max(0,i-1)]!.id});}
        } else if (this.model.page === 'approvals') {
          const rs=this.model.approvals.requests;if(rs.length){const i=Math.max(0,rs.findIndex(a=>a.id===this.model.approvals.selectedApprovalId));this.dispatch({type:'SELECT_APPROVAL',approvalId:rs[Math.max(0,i-1)]!.id});}
        } else if (this.model.page === 'graph') {
          const nodes=this.model.graph.nodes;if(nodes.length){const i=Math.max(0,nodes.findIndex(n=>n.id===this.model.graph.focus.nodeId));this.dispatch({type:'GRAPH_FOCUS',nodeId:nodes[Math.max(0,i-1)]!.id});}
        } else if (this.model.page === 'fleet') {
          const agents=this.model.fleet.agents;if(agents.length){const i=Math.max(0,agents.findIndex(a=>a.id===this.model.fleet.selectedAgentId));this.dispatch({type:'FLEET_SELECT_AGENT',agentId:agents[Math.max(0,i-1)]!.id});}
        } else this.dispatch({type:'SCROLL_UP',lines:1});
        break;
      }
      case 'down': {
        if (this.model.commandPalette.open) { this.dispatch({type:'COMMAND_PALETTE_MOVE',delta:1}); break; }
        if (this.model.page === 'decisions') {
          const rs=this.model.decisions.records;if(rs.length){const i=Math.max(0,rs.findIndex(d=>d.id===this.model.decisions.selectedDecisionId));this.dispatch({type:'SELECT_DECISION',decisionId:rs[Math.min(rs.length-1,i+1)]!.id});}
        } else if (this.model.page === 'approvals') {
          const rs=this.model.approvals.requests;if(rs.length){const i=Math.max(0,rs.findIndex(a=>a.id===this.model.approvals.selectedApprovalId));this.dispatch({type:'SELECT_APPROVAL',approvalId:rs[Math.min(rs.length-1,i+1)]!.id});}
        } else if (this.model.page === 'graph') {
          const nodes=this.model.graph.nodes;if(nodes.length){const i=Math.max(0,nodes.findIndex(n=>n.id===this.model.graph.focus.nodeId));this.dispatch({type:'GRAPH_FOCUS',nodeId:nodes[Math.min(nodes.length-1,i+1)]!.id});}
        } else if (this.model.page === 'fleet') {
          const agents=this.model.fleet.agents;if(agents.length){const i=Math.max(0,agents.findIndex(a=>a.id===this.model.fleet.selectedAgentId));this.dispatch({type:'FLEET_SELECT_AGENT',agentId:agents[Math.min(agents.length-1,i+1)]!.id});}
        } else this.dispatch({type:'SCROLL_DOWN',lines:1});
        break;
      }
    }
  }

  private handleEscape(): void {
    if (this.model.running) {
      this.cancelSession();
    } else if (this.model.applicationState === 'idle' || this.model.applicationState === 'ready') {
      this.dispatch({ type: 'SET_NOTIFICATION', text: 'Press Ctrl+Q to exit or Ctrl+C to cancel' });
    }
  }

  private handleCtrlC(): void {
    this.dispatch({ type: 'CTRL_C_PRESS' });
    
    if (this.model.applicationState === 'shutting_down') {
      this.requestShutdown();
    }
  }

  private requestShutdown(): void {
    this.dispatch({ type: 'SET_APPLICATION_STATE', state: 'shutting_down' });
    this.shutdown();
  }

  private async startSession(prompt: string): Promise<void> {
    if (this.model.missionState === 'running' || this.model.missionState === 'queued') return;
    
    this.dispatch({ type: 'MISSION_QUEUED', objective: prompt });
    
    const agents = Array.from(this.model.agents.values()).filter(a => a.status === 'ready');
    const mode = agents.some(a => a.id === 'opencode' || a.id === 'claude-code' || a.id === 'aider') ? 'execution' : 'communication';
    this.dispatch({ type: 'STATUS_TEXT', text: 'Starting mission…' });

    runSession(prompt, this.model.strategy, mode, {
      dispatch: (msg) => this.dispatch(msg),
      getModel: () => this.getModel(),
      onLog: (text) => this.onLog(text),
    }).catch((err) => {
      this.dispatch({ type: 'SESSION_ERROR', error: err instanceof Error ? err.message : String(err) });
    });
  }

  private cancelSession(): void {
    this.dispatch({ type: 'EXECUTION_CANCELLED', reason: 'Cancelled by user' });
  }

  private renderFrame(): void {
    writeFrame(buildFrame(this.model));
  }

  private shutdown(): void {
    if (this.frameInterval) { clearInterval(this.frameInterval); this.frameInterval = null; }
    if (this.logInterval) { clearInterval(this.logInterval); this.logInterval = null; }
    if (this.stopInput) { this.stopInput(); this.stopInput = null; }
    if (this.stopResize) { this.stopResize(); this.stopResize = null; }
    stopConsoleCapture();
    exitFullScreen();
  }
}