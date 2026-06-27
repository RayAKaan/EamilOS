import { spawn, type ChildProcess } from 'child_process';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { EventEmitter } from 'events';

export type AgentOperationalMode = 'communication_only' | 'unrestricted_execution' | 'communication' | 'execution';

export interface MultiplexedAgentTerminal {
  agentId: string;
  callsign: string;
  title: string;
  mode: AgentOperationalMode;
  terminalPid?: number;
}

export type TerminalEnvironment = 'single' | 'windows-terminal' | 'tmux' | 'iterm2' | 'vscode';

export interface AgentTerminalDef {
  id: string;
  callsign: string;
  command: string;
  args: string[];
  mode?: AgentOperationalMode;
}

function escapeForOsascript(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

export class AdaptiveMultiplexer extends EventEmitter {
  private activeTerminals: Map<string, MultiplexedAgentTerminal> = new Map();
  private processes: Map<string, ChildProcess> = new Map();
  private defaultMode: AgentOperationalMode;

  constructor(defaultMode: AgentOperationalMode = 'communication_only') {
    super();
    this.defaultMode = defaultMode;
  }

  static detectEnvironment(): TerminalEnvironment {
    if (process.env.CI === 'true' || process.env.CI === '1') return 'single';
    if (process.env.WT_SESSION) return 'windows-terminal';
    if (process.env.TMUX) return 'tmux';
    if (process.env.TERM_PROGRAM === 'iTerm.app') return 'iterm2';
    if (process.env.TERM_PROGRAM === 'vscode') return 'vscode';
    return 'single';
  }

  static isMultiplexingSupported(): boolean {
    return AdaptiveMultiplexer.detectEnvironment() !== 'single';
  }

  async spawnAgentTerminals(
    agents: AgentTerminalDef[],
    workingDir?: string
  ): Promise<MultiplexedAgentTerminal[]> {
    const env = AdaptiveMultiplexer.detectEnvironment();
    const spawned: MultiplexedAgentTerminal[] = [];

    for (const agent of agents) {
      const mode = agent.mode || this.defaultMode;
      const term: MultiplexedAgentTerminal = {
        agentId: agent.id,
        callsign: agent.callsign,
        title: `[${agent.callsign}] ${agent.id.toUpperCase()} (${mode.toUpperCase()})`,
        mode,
      };
      this.activeTerminals.set(agent.callsign, term);
      spawned.push(term);

      this.dispatchSplitCommand(term, agent.command, agent.args, env, workingDir);
    }

    if (spawned.length > 0) {
      this.emit('multiplexer:terminals-spawned', {
        count: spawned.length,
        environment: env,
        terminals: spawned,
      });
    }

    return spawned;
  }

  switchMode(callsign: string, newMode: AgentOperationalMode): void {
    const term = this.activeTerminals.get(callsign);
    if (term) {
      term.mode = newMode;
      term.title = `[${term.callsign}] ${term.agentId.toUpperCase()} (${newMode.toUpperCase()})`;
      this.emit('multiplexer:mode-switched', { callsign, mode: newMode });

      if (process.env.TMUX) {
        const pane = spawn('tmux', ['select-pane', '-t', term.callsign], { stdio: 'ignore' });
        pane.unref();
      }
    }
  }

  getActiveTerminals(): MultiplexedAgentTerminal[] {
    return Array.from(this.activeTerminals.values());
  }

  getTerminal(callsign: string): MultiplexedAgentTerminal | undefined {
    return this.activeTerminals.get(callsign);
  }

  getMode(callsign: string): AgentOperationalMode | undefined {
    return this.activeTerminals.get(callsign)?.mode;
  }

  terminateAll(): void {
    for (const [, proc] of this.processes) {
      proc.kill();
    }
    this.processes.clear();
    this.activeTerminals.clear();
    this.emit('multiplexer:terminals-closed');
  }

  private dispatchSplitCommand(
    term: MultiplexedAgentTerminal,
    command: string,
    args: string[],
    env: TerminalEnvironment,
    workingDir?: string
  ): void {
    const cwd = workingDir || process.cwd();

    try {
      switch (env) {
        case 'windows-terminal':
          this.spawnWindowsTerminal(term, command, args, cwd);
          break;
        case 'tmux':
          this.spawnTmux(term, cwd);
          break;
        case 'iterm2':
          this.spawnIterm2(term, command, args, cwd);
          break;
        case 'vscode':
          this.spawnVSCode(term, cwd);
          break;
      }
    } catch (err) {
      this.emit('multiplexer:split-failed', {
        callsign: term.callsign,
        error: (err as Error).message,
      });
    }
  }

  private spawnWindowsTerminal(term: MultiplexedAgentTerminal, command: string, args: string[], cwd: string): void {
    const safeTitle = term.title.replace(/"/g, '');
    const profileArgs = term.mode === 'communication_only' ? ['--profile', 'Command Prompt'] : [];
    const proc = spawn('wt', [
      '-w', '0', 'split-pane', '-V',
      '--title', safeTitle,
      ...profileArgs,
      'cmd.exe', '/c',
      command,
      ...args,
    ], {
      cwd,
      stdio: 'ignore',
      windowsHide: true,
    });
    this.processes.set(term.callsign, proc);
    proc.on('exit', () => this.processes.delete(term.callsign));
    this.emit('multiplexer:pane-spawned', { callsign: term.callsign, platform: 'windows-terminal' });
  }

  private spawnTmux(term: MultiplexedAgentTerminal, cwd: string): void {
    const proc = spawn('tmux', ['split-window', '-c', cwd], {
      stdio: 'ignore',
      windowsHide: true,
    });
    this.processes.set(term.callsign, proc);
    proc.on('exit', () => {
      this.processes.delete(term.callsign);
      const titleProc = spawn('tmux', ['select-pane', '-T', term.title], { stdio: 'ignore' });
      titleProc.unref();
    });
    this.emit('multiplexer:pane-spawned', { callsign: term.callsign, platform: 'tmux' });
  }

  private spawnIterm2(term: MultiplexedAgentTerminal, command: string, args: string[], cwd: string): void {
    const sessionsDir = resolve(cwd, '.eamilos', 'sessions', term.callsign);
    mkdirSync(sessionsDir, { recursive: true });
    const scriptPath = resolve(sessionsDir, 'agent.sh');
    const escapedCommand = command.includes(' ') ? `"${command}"` : command;
    const safeArgs = args.map((a) => a.replace(/'/g, "'\\''"));
    const scriptContent = `#!/bin/sh
cd "${cwd}"
${escapedCommand} ${safeArgs.map((a) => `'${a}'`).join(' ')}
`;
    writeFileSync(scriptPath, scriptContent, { mode: 0o755 });
    const safeTitle = escapeForOsascript(term.title);
    const safeScriptPath = escapeForOsascript(scriptPath);
    const script = `
tell application "iTerm"
  activate
  tell current window
    set newSession to (create tab with default profile)
    tell newSession
      set name "${safeTitle}"
      write text "${safeScriptPath}"
    end tell
  end tell
end tell`;
    const proc = spawn('osascript', ['-e', script], {
      stdio: 'ignore',
      windowsHide: true,
    });
    this.processes.set(term.callsign, proc);
    proc.on('exit', () => this.processes.delete(term.callsign));
    this.emit('multiplexer:pane-spawned', { callsign: term.callsign, platform: 'iterm2' });
  }

  private spawnVSCode(term: MultiplexedAgentTerminal, cwd: string): void {
    const proc = spawn('code', [
      '--terminal-split',
      '-c', cwd,
      '--title', term.title,
    ], {
      stdio: 'ignore',
      windowsHide: true,
    });
    this.processes.set(term.callsign, proc);
    proc.on('exit', () => this.processes.delete(term.callsign));
    this.emit('multiplexer:pane-spawned', { callsign: term.callsign, platform: 'vscode' });
  }
}

let globalMultiplexer: AdaptiveMultiplexer | null = null;

export function getAdaptiveMultiplexer(): AdaptiveMultiplexer {
  if (!globalMultiplexer) {
    globalMultiplexer = new AdaptiveMultiplexer();
  }
  return globalMultiplexer;
}
