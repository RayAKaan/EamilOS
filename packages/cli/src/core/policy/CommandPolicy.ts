import type { ExecutionPolicy } from './ExecutionPolicy.js';

export interface CommandCheck {
  allowed: boolean;
  requiresApproval: boolean;
  reason?: string;
}

const BLOCKED_COMMANDS: RegExp[] = [
  /^rm\s+-rf\s+\/\s*$/,
  /^sudo\s+/,
  /^chmod\s+-R\s+777\s+/,
  /^curl\s+.*\|\s*(bash|sh|zsh)\s*$/,
  /^wget\s+.*\|\s*(bash|sh|zsh)\s*$/,
  /^ssh\s+-/,
  /^scp\s+/,
  /^dd\s+if=/,
  /^mkfs\./,
  /^fdisk\s+/,
  /^>\/dev\/sda/,
];

const DANGEROUS_COMMANDS: RegExp[] = [
  /^rm\s+-rf\s+/,
  /^chmod\s+/,
  /^chown\s+/,
  /^kill\s+/,
  /^pkill\s+/,
  /^systemctl\s+/,
  /^service\s+/,
  /^docker\s+rm\s+/,
  /^docker\s+system\s+/,
  /^pip\s+install\s+/,
  /^npm\s+install\s+-g\s+/,
  /^cargo\s+install\s+/,
  /^git\s+push/, 
  /^git\s+commit/,
  /^git\s+reset/,
  /^git\s+rebase/,
  /^git\s+merge/,
  /^gh\s+/,
];

export function checkCommand(command: string, policy: ExecutionPolicy): CommandCheck {
  const trimmed = command.trim().toLowerCase();

  for (const pattern of BLOCKED_COMMANDS) {
    if (pattern.test(trimmed)) {
      return { allowed: false, requiresApproval: false, reason: `Command blocked by policy: matches dangerous pattern` };
    }
  }

  if (policy === 'safe') {
    const safePrefixes = ['ls', 'cat', 'head', 'tail', 'echo', 'pwd', 'which', 'node --version', 'npm --version', 'python --version', 'grep', 'find'];
    const isSafe = safePrefixes.some(p => trimmed.startsWith(p));
    if (!isSafe) {
      return { allowed: false, requiresApproval: false, reason: 'Only read-only commands allowed in safe policy' };
    }
    return { allowed: true, requiresApproval: false };
  }

  if (policy === 'workspace') {
    if (trimmed.startsWith('cd ') || trimmed.startsWith('..') || trimmed.startsWith('/')) {
      return { allowed: false, requiresApproval: false, reason: 'Cannot leave workspace directory' };
    }
    for (const pattern of DANGEROUS_COMMANDS) {
      if (pattern.test(trimmed)) {
        return { allowed: false, requiresApproval: true, reason: `Requires approval: ${pattern.source}` };
      }
    }
    return { allowed: true, requiresApproval: false };
  }

  if (policy === 'approved') {
    for (const pattern of DANGEROUS_COMMANDS) {
      if (pattern.test(trimmed)) {
        return { allowed: false, requiresApproval: true, reason: `Requires approval: ${pattern.source}` };
      }
    }
    return { allowed: true, requiresApproval: false };
  }

  return { allowed: true, requiresApproval: false };
}
