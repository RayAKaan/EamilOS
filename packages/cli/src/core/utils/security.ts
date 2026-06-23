import { resolve, isAbsolute, normalize } from 'path';

export function isPathTraversal(attemptedPath: string, basePath: string): boolean {
  const normalizedAttempted = normalize(attemptedPath);
  const normalizedBase = normalize(basePath);

  const resolvedAttempted = isAbsolute(attemptedPath) ? normalize(attemptedPath) : resolve(normalizedBase, normalizedAttempted);
  const resolvedBase = normalize(normalizedBase);

  if (!resolvedAttempted.startsWith(resolvedBase)) {
    return true;
  }

  const relative = resolvedAttempted.substring(resolvedBase.length);
  if (relative.startsWith('..')) {
    return true;
  }

  return false;
}

export function isWindowsPathTraversal(attemptedPath: string, basePath: string): boolean {
  const normalizedAttempted = normalize(attemptedPath).replace(/\\/g, '/');

  if (normalizedAttempted.includes('../') || normalizedAttempted.startsWith('..')) {
    const resolved = resolve(basePath, attemptedPath);
    const baseResolved = resolve(basePath);
    return !resolved.startsWith(baseResolved);
  }

  return false;
}

export function containsNullByte(input: string): boolean {
  return input.includes('\0');
}

export function containsControlChars(input: string): boolean {
  return /[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(input);
}

export function isValidFilename(filename: string): boolean {
  const invalidChars = /[<>:"|?*\x00-\x1F]/;
  const reservedNames = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;

  if (invalidChars.test(filename)) return false;
  if (reservedNames.test(filename)) return false;
  if (filename === '.' || filename === '..') return false;
  if (filename.length > 255) return false;

  return true;
}

export function sanitizeFilename(filename: string, replacement: string = '_'): string {
  let sanitized = filename.replace(/[<>:"|?*\x00-\x1F]/g, replacement);

  const reservedNames = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;
  if (reservedNames.test(sanitized)) {
    sanitized = replacement + sanitized;
  }

  if (sanitized === '.' || sanitized === '..') {
    sanitized = replacement;
  }

  if (sanitized.length > 255) {
    const ext = sanitized.includes('.') ? '.' + sanitized.split('.').pop() : '';
    const name = sanitized.slice(0, 255 - ext.length);
    sanitized = name + ext;
  }

  return sanitized;
}

export function sanitizePath(path: string): string {
  return path.replace(/\0/g, '').replace(/\\/g, '/').replace(/\/+/g, '/');
}

export function isValidCommand(command: string): boolean {
  const dangerousPatterns = [
    /;\s*rm\s+-rf/i,
    /;\s*del\s+\/[sfq]/i,
    /\$\(.*\)/,
    /`.*`/,
    /\{\{.*\}\}/,
    /\|.*\|/,
  ];

  for (const pattern of dangerousPatterns) {
    if (pattern.test(command)) {
      return false;
    }
  }

  return true;
}

export function detectSecrets(content: string): { found: boolean; patterns: string[] } {
  const secretPatterns = [
    { name: 'AWS Access Key', pattern: /AKIA[0-9A-Z]{16}/ },
    { name: 'AWS Secret Key', pattern: /(?<![A-Za-z0-9/+=])[A-Za-z0-9/+=]{40}(?![A-Za-z0-9/+=])/ },
    { name: 'GitHub Token', pattern: /gh[pousr]_[A-Za-z0-9_]{36,}/ },
    { name: 'OpenAI Key', pattern: /sk-[A-Za-z0-9_]{48}/ },
    { name: 'Anthropic Key', pattern: /sk-ant-[A-Za-z0-9_-]{95,}/ },
    { name: 'Generic API Key', pattern: /api[_-]?key["\s:=]+[A-Za-z0-9_-]{20,}/i },
    { name: 'Private Key', pattern: /-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/ },
    { name: 'Database URL', pattern: /(postgres|mysql|mongodb):\/\/[^\s]+:[^\s]+@[^\s]+/i },
    { name: 'Bearer Token', pattern: /Bearer [A-Za-z0-9_-]+/ },
    { name: 'Basic Auth', pattern: /Basic [A-Za-z0-9+/]+=*/ },
  ];

  const found: string[] = [];
  for (const { name, pattern } of secretPatterns) {
    if (pattern.test(content)) {
      found.push(name);
    }
  }

  return {
    found: found.length > 0,
    patterns: found,
  };
}

export function validateEnvVars(env: Record<string, string>, allowed: string[]): { valid: boolean; invalid: string[] } {
  const allowedLower = allowed.map((v) => v.toLowerCase());
  const invalid: string[] = [];

  for (const key of Object.keys(env)) {
    if (!allowedLower.includes(key.toLowerCase())) {
      invalid.push(key);
    }
  }

  return {
    valid: invalid.length === 0,
    invalid,
  };
}

export function sanitizeEnvVars(env: Record<string, string>, allowed: string[]): Record<string, string> {
  const sanitized: Record<string, string> = {};
  const allowedLower = allowed.map((v) => v.toLowerCase());

  for (const [key, value] of Object.entries(env)) {
    if (allowedLower.includes(key.toLowerCase())) {
      sanitized[key] = value;
    }
  }

  return sanitized;
}
