import path from 'path';
import { ExtractedFile, DELValidationError, DELErrorCode, SafePath, brandSafePath, DELConfig } from './types.js';

export interface SecurityValidationResult {
  valid: boolean;
  errors: DELValidationError[];
  safeFiles: Array<{ path: SafePath; content: string }>;
  rejectedFiles: Array<{ path: string; reason: string; code: DELErrorCode }>;
}

export interface SecretViolation {
  pattern: string;
  match: string;
  line?: number;
}

const BLOCKED_FILENAMES = new Set([
  'data.json', 'output.txt', 'file.txt', 'untitled', 'response.json',
  'result.json', 'output.json', 'temp.txt', 'example.txt', 'test.txt',
  'sample.txt', 'demo.txt',
  '.env', '.env.local', '.env.production', '.env.development',
  '.env.staging', '.env.test',
  'id_rsa', 'id_rsa.pub', 'id_ed25519', 'id_ed25519.pub',
  '.npmrc', '.pypirc', '.netrc', '.pgpass',
  'credentials.json', 'service-account.json', 'keyfile.json',
  '.git', '.gitconfig',
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
  'poetry.lock', 'gemfile.lock', 'composer.lock',
  '.ds_store', 'thumbs.db', 'desktop.ini',
  'node_modules',
]);

const BLOCKED_PATTERNS = [
  /^\.env\b/i,
  /^\.git\b/i,
  /secret/i,
  /credential/i,
  /password/i,
  /private[_-]?key/i,
];

const ALLOWED_DESPITE_PATTERN = new Set([
  '.gitignore', '.gitattributes', '.gitkeep', '.github',
]);

const SECRET_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: 'OpenAI API Key', pattern: /sk-[a-zA-Z0-9]{20,}/ },
  { name: 'Anthropic API Key', pattern: /sk-ant-[a-zA-Z0-9]{20,}/ },
  { name: 'Generic API Key', pattern: /api[_-]?key\s*[=:]\s*["']?[a-zA-Z0-9]{20,}/i },
  { name: 'Bearer Token', pattern: /bearer\s+[a-zA-Z0-9._-]{20,}/i },
  { name: 'Private Key Block', pattern: /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----/ },
  { name: 'AWS Access Key', pattern: /AKIA[0-9A-Z]{16}/ },
  { name: 'AWS Secret Key', pattern: /aws[_-]?secret[_-]?access[_-]?key\s*[=:]\s*["']?[a-zA-Z0-9/+=]{40}/i },
  { name: 'Generic Secret', pattern: /secret[_-]?key\s*[=:]\s*["']?[a-zA-Z0-9]{16,}/i },
  { name: 'Password Assignment', pattern: /password\s*[=:]\s*["']?[^'"]{8,}/i },
  { name: 'Auth Token', pattern: /auth[_-]?token\s*[=:]\s*["']?[a-zA-Z0-9_-]{20,}/i },
];

function normalizePath(p: string): string {
  return p
    .normalize('NFC')
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/$/, '');
}

function isAbsolutePath(p: string): boolean {
  if (p.startsWith('/')) return true;
  if (/^[a-zA-Z]:[\\\/]/.test(p)) return true;
  if (p.startsWith('\\\\')) return true;
  if (path.isAbsolute(p)) return true;
  return false;
}

function hasTraversal(p: string): boolean {
  const normalized = p.replace(/\\/g, '/');
  return normalized.includes('..');
}

function isBlockedFilename(filePath: string): { blocked: boolean; reason: string } {
  const normalized = filePath.trim().toLowerCase();
  const basename = normalized.split('/').pop() || normalized;

  if (ALLOWED_DESPITE_PATTERN.has(basename)) {
    return { blocked: false, reason: '' };
  }

  if (BLOCKED_FILENAMES.has(basename)) {
    return {
      blocked: true,
      reason: `Blocked filename: '${filePath}' matches blocked name '${basename}'`,
    };
  }

  if (BLOCKED_FILENAMES.has(normalized)) {
    return {
      blocked: true,
      reason: `Blocked path: '${filePath}' matches blocked path`,
    };
  }

  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(basename) || pattern.test(normalized)) {
      return {
        blocked: true,
        reason: `Blocked pattern: '${filePath}' matches pattern ${pattern.toString()}`,
      };
    }
  }

  return { blocked: false, reason: '' };
}

function detectSecrets(content: string): SecretViolation[] {
  const violations: SecretViolation[] = [];
  const lines = content.split('\n');

  for (const { name, pattern } of SECRET_PATTERNS) {
    let match: RegExpExecArray | null;
    const regex = new RegExp(pattern.source, pattern.flags);

    while ((match = regex.exec(content)) !== null) {
      let lineNum: number | undefined;

      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(match![0].substring(0, 10))) {
          lineNum = i + 1;
          break;
        }
      }

      violations.push({
        pattern: name,
        match: maskMatch(match[0]),
        line: lineNum,
      });

      if (!pattern.global) break;
    }
  }

  return violations;
}

function maskMatch(match: string): string {
  if (match.length >= 6) {
    return match.substring(0, 6) + '****';
  }
  return '******';
}

export function validateSecurity(
  files: ExtractedFile[],
  config: DELConfig
): SecurityValidationResult {
  const errors: DELValidationError[] = [];
  const safeFiles: Array<{ path: SafePath; content: string }> = [];
  const rejectedFiles: Array<{ path: string; reason: string; code: DELErrorCode }> = [];

  for (const file of files) {
    const { path: filePath, content } = file;
    const normalized = normalizePath(filePath);

    if (isAbsolutePath(normalized)) {
      rejectedFiles.push({
        path: filePath,
        reason: 'Absolute paths are forbidden',
        code: DELErrorCode.PATH_TRAVERSAL,
      });
      errors.push({
        code: DELErrorCode.PATH_TRAVERSAL,
        message: `Absolute path forbidden: ${filePath}`,
        context: filePath,
        stage: 'security',
        filePath,
      });
      continue;
    }

    if (hasTraversal(normalized)) {
      rejectedFiles.push({
        path: filePath,
        reason: 'Path traversal sequences (..) are forbidden',
        code: DELErrorCode.PATH_TRAVERSAL,
      });
      errors.push({
        code: DELErrorCode.PATH_TRAVERSAL,
        message: `Path traversal forbidden: ${filePath}`,
        context: normalized,
        stage: 'security',
        filePath,
      });
      continue;
    }

    const blockCheck = isBlockedFilename(normalized);
    if (blockCheck.blocked) {
      rejectedFiles.push({
        path: filePath,
        reason: blockCheck.reason,
        code: DELErrorCode.PATH_TRAVERSAL,
      });
      errors.push({
        code: DELErrorCode.PATH_TRAVERSAL,
        message: `Blocked path: ${blockCheck.reason}`,
        context: filePath,
        stage: 'security',
        filePath,
      });
      continue;
    }

    const resolvedPath = path.resolve(config.workspaceRoot, normalized);
    if (!resolvedPath.startsWith(config.workspaceRoot + path.sep) &&
        resolvedPath !== config.workspaceRoot) {
      rejectedFiles.push({
        path: filePath,
        reason: 'Path escapes workspace boundary',
        code: DELErrorCode.PATH_TRAVERSAL,
      });
      errors.push({
        code: DELErrorCode.PATH_TRAVERSAL,
        message: `Workspace escape: resolved path '${resolvedPath}' outside workspace '${config.workspaceRoot}'`,
        context: `Resolved: ${resolvedPath}`,
        stage: 'security',
        filePath,
      });
      continue;
    }

    const dangerousChars = /[<>"|?*\x00-\x1F]/;
    if (dangerousChars.test(normalized)) {
      rejectedFiles.push({
        path: filePath,
        reason: 'Path contains unsafe characters',
        code: DELErrorCode.PATH_TRAVERSAL,
      });
      errors.push({
        code: DELErrorCode.PATH_TRAVERSAL,
        message: 'Path contains unsafe characters',
        context: normalized,
        stage: 'security',
        filePath,
      });
      continue;
    }

    const secrets = detectSecrets(content);
    if (secrets.length > 0) {
      rejectedFiles.push({
        path: filePath,
        reason: `Secrets detected: ${secrets.map(s => s.pattern).join(', ')}`,
        code: DELErrorCode.SECRET_DETECTED,
      });
      errors.push({
        code: DELErrorCode.SECRET_DETECTED,
        message: `Secrets detected in ${filePath}: ${secrets.map(s => `${s.pattern} at line ${s.line || 'unknown'}`).join(', ')}`,
        context: secrets.map(s => `${s.pattern}: ${s.match}`).join('; '),
        stage: 'security',
        filePath,
      });
      continue;
    }

    safeFiles.push({
      path: brandSafePath(normalized),
      content,
    });
  }

  return {
    valid: safeFiles.length > 0,
    errors,
    safeFiles,
    rejectedFiles,
  };
}

export function isSecurityFailure(code: DELErrorCode): boolean {
  return code === DELErrorCode.PATH_TRAVERSAL || code === DELErrorCode.SECRET_DETECTED;
}
