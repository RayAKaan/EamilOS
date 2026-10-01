export type TerminalMode = 'full' | 'adaptive' | 'inline' | 'line';

export interface TerminalCapabilities {
  isTTY: boolean;
  stdinTTY: boolean;
  stdoutTTY: boolean;
  width: number;
  height: number;
  color: 'truecolor' | 'ansi256' | 'ansi16' | 'none';
  unicode: boolean;
  mouse: boolean;
  alternateScreen: boolean;
  ssh: boolean;
  tmux: boolean;
  screen: boolean;
  windowsTerminal: boolean;
  powershell: boolean;
  wsl: boolean;
  ci: boolean;
  dumb: boolean;
  mode: TerminalMode;
}

function detectColor(env: NodeJS.ProcessEnv): TerminalCapabilities['color'] {
  if (env.NO_COLOR !== undefined || env.EAMILOS_THEME === 'no-color' || env.TERM === 'dumb') return 'none';
  if (/truecolor|24bit/i.test(env.COLORTERM ?? '') || Boolean(env.WT_SESSION)) return 'truecolor';
  if (/-256(color)?$/i.test(env.TERM ?? '')) return 'ansi256';
  return 'ansi16';
}

function detectUnicode(env: NodeJS.ProcessEnv): boolean {
  if (env.EAMILOS_ASCII === '1') return false;
  const locale = env.LC_ALL ?? env.LC_CTYPE ?? env.LANG ?? '';
  if (!locale) return true;
  return !/^C(?:\.|$)/i.test(locale);
}

export interface TerminalDetectionOverrides { stdinTTY?: boolean; stdoutTTY?: boolean; width?: number; height?: number; }

export function detectTerminalCapabilities(env: NodeJS.ProcessEnv = process.env, overrides: TerminalDetectionOverrides = {}): TerminalCapabilities {
  const stdinTTY = overrides.stdinTTY ?? Boolean(process.stdin.isTTY);
  const stdoutTTY = overrides.stdoutTTY ?? Boolean(process.stdout.isTTY);
  const ssh = Boolean(env.SSH_CONNECTION || env.SSH_TTY || env.SSH_CLIENT);
  const tmux = Boolean(env.TMUX);
  const screen = Boolean(env.STY);
  const windowsTerminal = Boolean(env.WT_SESSION);
  const powershell = Boolean(env.PSModulePath) && Boolean(env.PSVersionTable ?? env.POWERSHELL_DISTRIBUTION_CHANNEL);
  const wsl = Boolean(env.WSL_DISTRO_NAME || env.WSL_INTEROP);
  const ci = env.CI === 'true' || env.CI === '1';
  const dumb = env.TERM === 'dumb';

  let mode: TerminalMode;
  if (!stdinTTY || !stdoutTTY || ci || dumb) mode = 'line';
  else if (ssh || tmux || screen) mode = 'adaptive';
  else if (env.EAMILOS_INLINE === '1') mode = 'inline';
  else mode = 'full';

  return {
    isTTY: stdinTTY && stdoutTTY,
    stdinTTY,
    stdoutTTY,
    width: overrides.width ?? process.stdout.columns ?? 80,
    height: overrides.height ?? process.stdout.rows ?? 24,
    color: detectColor(env),
    unicode: detectUnicode(env),
    mouse: stdinTTY && stdoutTTY && env.EAMILOS_MOUSE !== '0',
    alternateScreen: mode === 'full' || mode === 'adaptive',
    ssh, tmux, screen, windowsTerminal, powershell, wsl, ci, dumb, mode,
  };
}

export function terminalCapabilitySummary(capabilities: TerminalCapabilities): string {
  const transport = capabilities.ssh ? 'SSH' : capabilities.tmux ? 'tmux' : capabilities.screen ? 'screen' : 'local';
  return `${capabilities.mode.toUpperCase()} · ${transport} · ${capabilities.color} · ${capabilities.unicode ? 'unicode' : 'ascii'}`;
}
