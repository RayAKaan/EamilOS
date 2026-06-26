import { checkFileWrite, type FileCheck } from '../policy/FilePolicy.js';
import type { FileChange } from '../changes/ChangeCollector.js';
import type { ExecutionPolicy } from '../policy/ExecutionPolicy.js';

export interface ValidationIssue {
  path: string;
  severity: 'error' | 'warning';
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
  blocked: string[];
}

interface SyntaxError {
  message: string;
  line?: number;
  column?: number;
}

function validateTypeScript(content: string): SyntaxError[] {
  const errors: SyntaxError[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    const templateLitMatch = line.match(/`/g);
    if (templateLitMatch && templateLitMatch.length % 2 !== 0) {
      errors.push({ message: 'Unterminated template literal', line: lineNum });
    }

    const parenOpen = (line.match(/\(/g) || []).length;
    const parenClose = (line.match(/\)/g) || []).length;
    if (parenOpen !== parenClose) {
      errors.push({ message: 'Mismatched parentheses', line: lineNum });
    }

    const braceOpen = (line.match(/\{/g) || []).length;
    const braceClose = (line.match(/\}/g) || []).length;
    if (braceOpen !== braceClose && !line.trim().startsWith('//')) {
      errors.push({ message: 'Mismatched braces', line: lineNum });
    }

    const bracketOpen = (line.match(/\[/g) || []).length;
    const bracketClose = (line.match(/\]/g) || []).length;
    if (bracketOpen !== bracketClose && !line.trim().startsWith('//')) {
      errors.push({ message: 'Mismatched brackets', line: lineNum });
    }
  }

  return errors;
}

function validateContentSyntax(path: string, content: string): SyntaxError[] {
  if (!content) return [];

  const ext = path.toLowerCase().split('.').pop();

  if (ext === 'ts' || ext === 'tsx') {
    return validateTypeScript(content);
  }

  if (ext === 'js' || ext === 'jsx') {
    return validateTypeScript(content);
  }

  if (ext === 'json') {
    try {
      JSON.parse(content);
    } catch {
      return [{ message: 'Invalid JSON syntax' }];
    }
  }

  return [];
}

const BLOCKED_FILENAMES = [
  '.env',
  '.env.local',
  '.env.production',
  '.git/config',
  '.git/HEAD',
  '.npmrc',
  '.yarnrc',
  'id_rsa',
  'id_rsa.pub',
  '.netrc',
  '.aws/credentials',
  '.ssh/config',
];

const SECRET_PATTERNS = [
  /sk-[a-zA-Z0-9]{20,}/,
  /AIza[0-9A-Za-z\-_]{35}/,
  /ghp_[a-zA-Z0-9]{36}/,
  /gho_[a-zA-Z0-9]{36}/,
  /xox[bpras]-[0-9a-zA-Z\-]{10,}/,
  /api[_-]?key['"]?\s*[:=]\s*['"]?[a-zA-Z0-9_\-]{16,}/i,
  /ANTHROPIC_API_KEY|OPENAI_API_KEY|GOOGLE_API_KEY|GEMINI_API_KEY/,
];

const TODO_PATTERNS = [
  /TODO/i,
  /FIXME/i,
  /HACK/i,
  /XXX:/,
  /implement later/i,
  /placeholder/i,
  /stub\s*implementation/i,
];

const BLOCKED_FILE_EXTENSIONS = [
  '.exe', '.dll', '.so', '.dylib', '.bin',
  '.pem', '.key', '.cert', '.p12', '.jks',
  '.class', '.pyc', '.o', '.obj',
];

export function validateFileChange(change: FileChange, policy: ExecutionPolicy): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  const pathLower = change.path.toLowerCase();
  const ext = pathLower.slice(pathLower.lastIndexOf('.'));

  for (const blocked of BLOCKED_FILENAMES) {
    if (pathLower === blocked || pathLower.endsWith('/' + blocked)) {
      issues.push({ path: change.path, severity: 'error', message: `Blocked filename: ${change.path}` });
      return issues;
    }
  }

  if (BLOCKED_FILE_EXTENSIONS.includes(ext)) {
    issues.push({ path: change.path, severity: 'error', message: `Blocked file extension: ${ext}` });
    return issues;
  }

  if (change.path.includes('..') || change.path.startsWith('/')) {
    issues.push({ path: change.path, severity: 'error', message: 'Path traversal detected' });
    return issues;
  }

  if (change.content) {
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.test(change.content)) {
        issues.push({ path: change.path, severity: 'error', message: 'Possible secret/API key leak detected' });
        break;
      }
    }

    for (const pattern of TODO_PATTERNS) {
      if (pattern.test(change.content)) {
        issues.push({ path: change.path, severity: 'warning', message: 'Contains placeholder/TODO markers' });
        break;
      }
    }

    const syntaxErrors = validateContentSyntax(change.path, change.content);
    for (const se of syntaxErrors) {
      issues.push({
        path: change.path,
        severity: 'warning',
        message: se.line ? `Syntax: ${se.message} (line ${se.line})` : `Syntax: ${se.message}`,
      });
    }
  }

  const policyCheck = checkFileWrite(change.path, policy);
  if (!policyCheck.allowed) {
    issues.push({ path: change.path, severity: 'error', message: policyCheck.reason || 'Blocked by file policy' });
  }

  return issues;
}

export function validateChanges(changes: FileChange[], policy: ExecutionPolicy): ValidationResult {
  const allIssues: ValidationIssue[] = [];
  const blocked: string[] = [];

  for (const change of changes) {
    const issues = validateFileChange(change, policy);
    allIssues.push(...issues);
    if (issues.some(i => i.severity === 'error')) {
      blocked.push(change.path);
    }
  }

  return {
    valid: blocked.length === 0,
    issues: allIssues,
    blocked,
  };
}
