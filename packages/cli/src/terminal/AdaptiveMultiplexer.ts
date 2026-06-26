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

function shellQuote(args: string[]): string {
  return args.map(a => {
    if (/^[a-zA-Z0-9_\/\.\-\:]+$/.test(a)) return a;
    return `'${a.replace(/'/g, "'\\''")}'`;
  }).join(' ');
}

function windowsQuote(args: string[]): string {
  const parts = args.map(a => {
    if (/^[a-zA-Z0-9_\/\.\-\:]+$/.test(a)) return a;
    const escaped = a.replace(/"/g, '\\"');
    return `"${escaped}"`;
  });
  return parts.join(' ');
}

function escapeForOsascript(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
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
    const cwd = workingDir || process.cwd();

    try {
      switch (env) {
        case 'windows-terminal':
          this.spawnWindowsTerminal(term, command, args, cwd);
          break;
        case 'tmux':
          this.spawnTmux(term, command, args, cwd);
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
    const quotedArgs = windowsQuote(args);
    const safeTitle = term.title.replace(/"/g, '');
    const profile = term.mode === 'communication_only' ? '--profile "Command Prompt"' : '';
    execSync(
      `wt -w 0 split-pane -V --title "${safeTitle}" ${profile} cmd.exe /c "cd /d ${cwd} && ${command} ${quotedArgs}"`,
      { stdio: 'ignore', timeout: 10000 }
    );
    this.emit('multiplexer:pane-spawned', { callsign: term.callsign, platform: 'windows-terminal' });
  }

  private spawnTmux(term: MultiplexedAgentTerminal, command: string, args: string[], cwd: string): void {
    const existingCount = this.activeTerminals.size;
    const direction = existingCount % 2 === 0 ? '-h' : '-v';
    const safeCwd = cwd.replace(/"/g, '\\"');
    const quotedCmd = shellQuote([command, ...args]);

    execSync(`tmux split-window ${direction} -c "${safeCwd}" "${quotedCmd}"`, {
      stdio: 'ignore',
      timeout: 10000,
    });
    execSync(`tmux select-pane -T "${term.title.replace(/"/g, '')}"`, { stdio: 'ignore', timeout: 2000 });

    if (this.activeTerminals.size >= 3) {
      try {
        execSync('tmux select-layout tiled', { stdio: 'ignore', timeout: 2000 });
      } catch {}
    }

    this.emit('multiplexer:pane-spawned', { callsign: term.callsign, platform: 'tmux' });
  }

  private spawnIterm2(term: MultiplexedAgentTerminal, command: string, args: string[], cwd: string): void {
    const safeTitle = escapeForOsascript(term.title);
    const safeCmd = escapeForOsascript(`${command} ${shellQuote(args)}`);
    const safeCwd = escapeForOsascript(cwd);
    const script = `
tell application "iTerm"
  activate
  tell current window
    set newSession to (create tab with default profile)
    tell newSession
      set name "${safeTitle}"
      write text "cd ${safeCwd} && ${safeCmd}"
    end tell
  end tell
end tell`;
    execSync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, { stdio: 'ignore', timeout: 10000 });
    this.emit('multiplexer:pane-spawned', { callsign: term.callsign, platform: 'iterm2' });
  }

  private spawnVSCode(term: MultiplexedAgentTerminal, cwd: string): void {
    const safeTitle = term.title.replace(/["']/g, '');
    const safeCwd = cwd.replace(/"/g, '');
    execSync(
      `code --terminal-split -c "${safeCwd}" --title "${safeTitle}"`,
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
