import type { ExecutionPolicy } from './ExecutionPolicy.js';

export interface FileCheck {
  allowed: boolean;
  requiresApproval: boolean;
  reason?: string;
}

const BLOCKED_PATHS: RegExp[] = [
  /\.env$/,
  /\.env\./,
  /\.git\/config/,
  /\.git\/HEAD/,
  /\.git\/index/,
  /\.gitignore$/,
  /\.dockerignore$/,
  /\.npmrc$/,
  /\.yarnrc$/,
  /node_modules\//,
  /\.credentials/,
  /\.aws\//,
  /\.ssh\//,
  /id_rsa/,
  /\.pem$/,
  /\.key$/,
];

const SENSITIVE_PATHS: RegExp[] = [
  /\/\.env/,
  /\/\.git\//,
  /\/\.config\//,
  /\/\.aws\//,
  /\/\.ssh\//,
  /secrets\./,
  /passwords?\./,
  /credentials?\./,
  /api[_-]?key/,
  /token\./,
  /\.p12$/,
  /\.jks$/,
  /keystore/,
];

export function checkFileWrite(filePath: string, policy: ExecutionPolicy): FileCheck {
  const normalized = filePath.replace(/\\/g, '/');

  if (normalized.startsWith('..') || normalized.startsWith('/')) {
    return { allowed: false, requiresApproval: false, reason: 'Path traversal: writing outside workspace' };
  }

  for (const pattern of BLOCKED_PATHS) {
    if (pattern.test(normalized)) {
      return { allowed: false, requiresApproval: false, reason: `Cannot write to blocked path: ${filePath}` };
    }
  }

  if (policy === 'safe') {
    return { allowed: false, requiresApproval: false, reason: 'File writes not allowed in safe policy' };
  }

  if (policy === 'workspace') {
    for (const pattern of SENSITIVE_PATHS) {
      if (pattern.test(normalized)) {
        return { allowed: false, requiresApproval: true, reason: `Sensitive path requires approval: ${filePath}` };
      }
    }
    return { allowed: true, requiresApproval: false };
  }

  if (policy === 'approved') {
    for (const pattern of SENSITIVE_PATHS) {
      if (pattern.test(normalized)) {
        return { allowed: false, requiresApproval: true, reason: `Sensitive path requires approval: ${filePath}` };
      }
    }
    return { allowed: true, requiresApproval: false };
  }

  return { allowed: true, requiresApproval: false };
}
