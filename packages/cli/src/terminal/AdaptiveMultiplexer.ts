import { execSync, spawn } from 'child_process';
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

export class AdaptiveMultiplexer extends EventEmitter {
  private activeTerminals: Map<string, MultiplexedAgentTerminal> = new Map();
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
        try {
          execSync(`tmux select-pane -t "${term.callsign}"`, { stdio: 'ignore' });
        } catch {}
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
    if (process.env.TMUX) {
      try {
        execSync('tmux select-layout even-horizontal', { stdio: 'ignore' });
      } catch {}
    }
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
    const cmdStr = [command, ...args].join(' ');
    const cwd = workingDir || process.cwd();

    try {
      switch (env) {
        case 'windows-terminal':
          this.spawnWindowsTerminal(term, cmdStr, cwd);
          break;
        case 'tmux':
          this.spawnTmux(term, cmdStr, cwd);
          break;
        case 'iterm2':
          this.spawnIterm2(term, cmdStr, cwd);
          break;
        case 'vscode':
          this.spawnVSCode(term, cmdStr, cwd);
          break;
      }
    } catch (err) {
      this.emit('multiplexer:split-failed', {
        callsign: term.callsign,
        error: (err as Error).message,
      });
    }
  }

  private spawnWindowsTerminal(term: MultiplexedAgentTerminal, cmd: string, cwd: string): void {
    const profile = term.mode === 'communication_only' ? '--profile "Command Prompt"' : '';
    execSync(
      `wt -w 0 split-pane -V --title "${term.title}" ${profile} cmd.exe /c "cd /d ${cwd} && ${cmd}"`,
      { stdio: 'ignore', timeout: 10000 }
    );
    this.emit('multiplexer:pane-spawned', { callsign: term.callsign, platform: 'windows-terminal' });
  }

  private spawnTmux(term: MultiplexedAgentTerminal, cmd: string, cwd: string): void {
    const existingCount = this.activeTerminals.size;
    const direction = existingCount % 2 === 0 ? '-h' : '-v';

    execSync(`tmux split-window ${direction} -c "${cwd}" "${cmd}"`, {
      stdio: 'ignore',
      timeout: 10000,
    });
    execSync(`tmux select-pane -T "${term.title}"`, { stdio: 'ignore', timeout: 2000 });

    if (this.activeTerminals.size >= 3) {
      try {
        execSync('tmux select-layout tiled', { stdio: 'ignore', timeout: 2000 });
      } catch {}
    }

    this.emit('multiplexer:pane-spawned', { callsign: term.callsign, platform: 'tmux' });
  }

  private spawnIterm2(term: MultiplexedAgentTerminal, cmd: string, _cwd: string): void {
    const script = `
tell application "iTerm"
  activate
  tell current window
    set newSession to (create tab with default profile)
    tell newSession
      set name "${term.title}"
      write text "${cmd.replace(/"/g, '\\"')}"
    end tell
  end tell
end tell`;
    execSync(`osascript -e '${script}'`, { stdio: 'ignore', timeout: 10000 });
    this.emit('multiplexer:pane-spawned', { callsign: term.callsign, platform: 'iterm2' });
  }

  private spawnVSCode(term: MultiplexedAgentTerminal, cmd: string, cwd: string): void {
    const title = term.title.replace(/["']/g, '');
    execSync(
      `code --terminal-split -c "${cwd}" --title "${title}"`,
      { stdio: 'ignore', timeout: 10000 }
    );
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
