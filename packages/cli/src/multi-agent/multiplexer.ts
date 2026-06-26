import { spawn, execSync } from 'child_process';

export type TerminalEnvironment = 'single' | 'windows-terminal' | 'tmux' | 'iterm2' | 'vscode';

export interface MultiplexerOptions {
  agents: { name: string; command: string; args: string[] }[];
  task: string;
  workingDir?: string;
}

export function detectEnvironment(): TerminalEnvironment {
  if (process.env.CI === 'true' || process.env.CI === '1') {
    return 'single';
  }

  if (process.env.WT_SESSION) {
    return 'windows-terminal';
  }

  if (process.env.TMUX) {
    return 'tmux';
  }

  if (process.env.TERM_PROGRAM === 'iTerm.app') {
    return 'iterm2';
  }

  if (process.env.TERM_PROGRAM === 'vscode') {
    return 'vscode';
  }

  return 'single';
}

export async function spawnSplitTerminals(options: MultiplexerOptions): Promise<void> {
  const env = detectEnvironment();

  switch (env) {
    case 'windows-terminal':
      spawnWindowsTerminal(options);
      break;
    case 'tmux':
      spawnTmux(options);
      break;
    case 'iterm2':
      spawnIterm2(options);
      break;
    case 'vscode':
      spawnVSCode(options);
      break;
    default:
      console.log('No multiplex-capable terminal detected. Use single viewport mode.');
  }
}

function spawnWindowsTerminal(options: MultiplexerOptions): void {
  const agents = options.agents;

  if (agents.length === 0) return;

  // First agent runs in the current pane
  const firstCmd = buildAgentCommand(agents[0]);
  execSync(firstCmd, { stdio: 'inherit', cwd: options.workingDir });

  // Subsequent agents get split panes
  for (let i = 1; i < agents.length; i++) {
    const direction = i % 2 === 0 ? '-H' : '-V';
    const cmd = buildAgentCommand(agents[i]);
    try {
      execSync(
        `wt -w 0 split-pane ${direction} --title "${agents[i].name}" cmd.exe /c "${cmd}"`,
        { stdio: 'inherit', timeout: 5000, cwd: options.workingDir }
      );
    } catch {
      // Fallback: run sequentially in current terminal
      execSync(cmd, { stdio: 'inherit', cwd: options.workingDir });
    }
  }
}

function spawnTmux(options: MultiplexerOptions): void {
  const agents = options.agents;
  if (agents.length === 0) return;

  // First agent runs in current pane
  const firstCmd = buildAgentCommand(agents[0]);
  execSync(firstCmd, { stdio: 'inherit', cwd: options.workingDir });

  // Split for remaining agents
  for (let i = 1; i < agents.length; i++) {
    const direction = i % 2 === 0 ? '-v' : '-h';
    const cmd = buildAgentCommand(agents[i]);
    try {
      execSync(
        `tmux split-window ${direction} "${cmd}"`,
        { stdio: 'inherit', timeout: 5000, cwd: options.workingDir }
      );
    } catch {
      execSync(cmd, { stdio: 'inherit', cwd: options.workingDir });
    }
  }

  // Apply tiled layout if 3+ agents
  if (agents.length >= 3) {
    try {
      execSync('tmux select-layout tiled', { stdio: 'inherit', timeout: 2000 });
    } catch {}
  }
}

function spawnIterm2(_options: MultiplexerOptions): void {
  // iTerm2 AppleScript-based split pane - best effort
  const script = `
tell application "iTerm"
  activate
  tell current session of current window
    split horizontally with default profile
  end tell
end tell
  `;

  try {
    execSync(`osascript -e '${script}'`, { stdio: 'inherit', timeout: 5000 });
  } catch {
    console.log('iTerm2 split not available. Falling back to sequential execution.');
  }
}

function spawnVSCode(options: MultiplexerOptions): void {
  const agents = options.agents;

  for (const agent of agents) {
    const cmd = buildAgentCommand(agent);
    try {
      // VS Code terminal split escape sequence
      const vscodeCmd = `code --terminal-split --command "${cmd}"`;
      execSync(vscodeCmd, { stdio: 'inherit', timeout: 5000, cwd: options.workingDir });
    } catch {
      execSync(cmd, { stdio: 'inherit', cwd: options.workingDir });
    }
  }
}

function buildAgentCommand(agent: { name: string; command: string; args: string[] }): string {
  const escapedArgs = agent.args.map(a => a.includes(' ') ? `"${a}"` : a).join(' ');
  return `${agent.command} ${escapedArgs}`;
}

export function canMultiplex(): boolean {
  return detectEnvironment() !== 'single';
}
