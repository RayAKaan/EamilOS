import { resolve, isAbsolute, sep } from 'path';

export class PathTraversalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PathTraversalError';
  }
}

export class FileSizeLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FileSizeLimitError';
  }
}

export class WorkspaceSizeLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkspaceSizeLimitError';
  }
}

export function validateAndResolvePath(
  baseDir: string,
  projectId: string,
  filePath: string
): string {
  if (filePath.includes('..') || isAbsolute(filePath)) {
    throw new PathTraversalError(`Dangerous path rejected: ${filePath}`);
  }

  const projectRoot = resolve(baseDir, projectId);
  const resolved = resolve(projectRoot, filePath);

  const normalizedProjectRoot = projectRoot.endsWith(sep)
    ? projectRoot
    : projectRoot + sep;
  const normalizedResolved = resolved.endsWith(sep)
    ? resolved
    : resolved + sep;

  if (
    !normalizedResolved.startsWith(normalizedProjectRoot) &&
    resolved !== projectRoot
  ) {
    throw new PathTraversalError(`Path escapes project root: ${filePath}`);
  }

  return resolved;
}

export function validateFileSize(
  size: number,
  maxSizeMb: number
): void {
  const maxBytes = maxSizeMb * 1024 * 1024;
  if (size > maxBytes) {
    throw new FileSizeLimitError(
      `File size ${size} bytes exceeds limit of ${maxSizeMb}MB`
    );
  }
}

export function detectSecrets(content: string): string[] {
  const patterns = [
    /sk-[a-zA-Z0-9]{32,}/,
    /api[_-]?key["\s:=]+['"]?[a-zA-Z0-9]{20,}['"]?/i,
    /bearer\s+[a-zA-Z0-9_\-\.]+/i,
    /password["\s:=]+['"]?[^'"]{8,}['"]?/i,
    /secret["\s:=]+['"]?[a-zA-Z0-9]{16,}['"]?/i,
    /token["\s:=]+['"]?[a-zA-Z0-9_\-\.]{20,}['"]?/i,
  ];

  const secrets: string[] = [];
  for (const pattern of patterns) {
    const matches = content.match(pattern);
    if (matches) {
      secrets.push(...matches);
    }
  }

  return [...new Set(secrets)];
}

export function sanitizeEnvironment(env: Record<string, string | undefined>): Record<string, string | undefined> {
  const sanitized: Record<string, string | undefined> = {};
  const sensitiveKeys = [
    'API_KEY',
    'SECRET',
    'PASSWORD',
    'TOKEN',
    'PRIVATE_KEY',
    'AWS_SECRET',
  ];

  for (const [key, value] of Object.entries(env)) {
    const isSensitive = sensitiveKeys.some((s) =>
      key.toUpperCase().includes(s)
    );
    sanitized[key] = isSensitive ? '[REDACTED]' : value;
  }

  return sanitized;
}
