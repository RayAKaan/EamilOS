import { ExtractedFile, DELValidationError, DELErrorCode } from './types.js';
import { parse } from 'acorn';

const MAX_FILE_SIZE = 50_000;
const MAX_LINES = 1500;

function logValidationMetric(data: {
  size: number;
  lines: number;
  rejected: boolean;
  reason?: string;
  fileType?: string;
}): void {
  if (process.env.EAMILOS_LOG_VALIDATION === 'true') {
    console.log('[VALIDATION]', JSON.stringify(data));
  }
}

export interface ContentValidationResult {
  valid: boolean;
  errors: DELValidationError[];
  validFiles: ExtractedFile[];
  rejectedFiles: Array<{ path: string; reason: string; code: DELErrorCode }>;
}

const PLACEHOLDER_PATTERNS = [
  { pattern: /TODO/i, message: 'TODO placeholder found' },
  { pattern: /FIXME/i, message: 'FIXME placeholder found' },
  { pattern: /\.\.\.\s*$/, message: 'Trailing ellipsis found' },
  { pattern: /\/\/\s*implementation\s*(here|needed|required)/i, message: 'Implementation placeholder found' },
  { pattern: /<insert\s+code>/i, message: 'Insert code placeholder found' },
  { pattern: /<replace.*?>/i, message: 'Replace placeholder found' },
  { pattern: /\[\s*\.\.\.\s*\]/, message: 'Array placeholder found' },
  { pattern: /\{\s*\.\.\.\s*\}/, message: 'Object placeholder found' },
  { pattern: /___+/, message: 'Underscore placeholder found' },
  { pattern: /Lorem\s+ipsum/i, message: 'Lorem ipsum placeholder found' },
  { pattern: /\/\/\s*your\s+code\s*(here|below)/i, message: 'Your code here placeholder found' },
  { pattern: /\/\/\s*add\s+(your|more)\s+\w+\s+here/i, message: 'Add your code placeholder found' },
];

const DESCRIPTION_PATTERNS = [
  /^This\s+(file|is|will|creates?)/i,
  /^Here\s+(is|are)/i,
  /^The\s+following/i,
  /^I\s+will/i,
  /^Create\s+a/i,
  /^Below\s+is/i,
  /^A\s+(simple|basic|bare)/i,
  /^Example:/i,
  /^Here's\s+/i,
  /^Note:/i,
  /^Tip:/i,
  /^Step\s+\d+:/i,
];

const CODE_KEYWORDS = new Set([
  'import', 'export', 'from', 'const', 'let', 'var', 'function',
  'class', 'interface', 'type', 'enum', 'return', 'if', 'else',
  'for', 'while', 'switch', 'case', 'break', 'continue', 'try',
  'catch', 'finally', 'throw', 'new', 'this', 'super', 'extends',
  'implements', 'public', 'private', 'protected', 'static', 'async',
  'await', 'def', 'print', 'fn', 'pub', 'struct', 'impl',
  'module', 'require', 'exports', 'lambda', 'yield',
  'func', 'package', 'go', 'defer', 'chan', 'select',
  'fn', 'mut', 'pub', 'impl', 'trait', 'where',
  'sub', 'select', 'if', 'unless', 'elsif',
  'def', 'end', 'unless', 'case', 'when', 'rescue', 'ensure',
]);

function detectPlaceholders(content: string): string[] {
  const found: string[] = [];

  for (const { pattern, message } of PLACEHOLDER_PATTERNS) {
    if (pattern.test(content)) {
      found.push(message);
    }
  }

  return found;
}

function isDescriptionContent(content: string): boolean {
  const trimmed = content.trim();

  if (trimmed.length < 20) {
    const words = trimmed.split(/\s+/);
    const hasCodeKeyword = words.some(w => CODE_KEYWORDS.has(w));
    if (!hasCodeKeyword && /[{}\[\]();=<>]/.test(trimmed)) {
      return false;
    }
    if (hasCodeKeyword) {
      return false;
    }
    return true;
  }

  const codeChars = (trimmed.match(/[{}\[\]();=:<>+\-*/&|]/g) || []).length;
  const codeRatio = codeChars / trimmed.length;

  if (codeRatio < 0.03) {
    return true;
  }

  for (const pattern of DESCRIPTION_PATTERNS) {
    if (pattern.test(trimmed)) {
      return true;
    }
  }

  return false;
}

function calculateCodeDensity(content: string): number {
  const lines = content.split('\n');
  let codeLines = 0;
  let totalLines = 0;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed === '') {
      continue;
    }

    totalLines++;

    if (trimmed.startsWith('//') || trimmed.startsWith('#') ||
        trimmed.startsWith('/*') || trimmed.startsWith('*') ||
        trimmed.startsWith('<!--')) {
      continue;
    }

    if (trimmed.startsWith('"""') || trimmed.startsWith("'''")) {
      continue;
    }

    codeLines++;
  }

  return totalLines > 0 ? codeLines / totalLines : 0;
}

interface SyntaxCheckResult {
  valid: boolean;
  error?: string;
}

function getExtension(path: string): string {
  const parts = path.split('.');
  return parts.length >= 2 ? parts[parts.length - 1].toLowerCase() : '';
}

function enforceLimits(content: string): void {
  if (content.length > MAX_FILE_SIZE) {
    throw new Error('File too large');
  }
  if (content.split('\n').length > MAX_LINES) {
    throw new Error('Too many lines');
  }
}

function detectDangerousPatterns(content: string): SyntaxCheckResult {
  if (/while\s*\(\s*true\s*\)/.test(content)) {
    return { valid: false, error: 'Dangerous pattern (infinite loop) detected' };
  }
  if (/for\s*\(\s*;\s*;\s*\)/.test(content)) {
    return { valid: false, error: 'Dangerous pattern (infinite loop) detected' };
  }
  if (/\.\*.*\.\*/.test(content) && / \+/.test(content)) {
    return { valid: false, error: 'Potential regex DoS detected' };
  }
  return { valid: true };
}

function checkJavaScriptSyntax(content: string): SyntaxCheckResult {
  try {
    enforceLimits(content);

    const patternCheck = detectDangerousPatterns(content);
    if (!patternCheck.valid) {
      logValidationMetric({ size: content.length, lines: content.split('\n').length, rejected: true, reason: patternCheck.error });
      return patternCheck;
    }

    parse(content, { ecmaVersion: 'latest', sourceType: 'module' });
    logValidationMetric({ size: content.length, lines: content.split('\n').length, rejected: false });
    return { valid: true };
  } catch (e: any) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    logValidationMetric({ size: content.length, lines: content.split('\n').length, rejected: true, reason: errorMsg });
    return { valid: false, error: `Syntax error: ${errorMsg}` };
  }
}

function checkTypeScriptSyntax(content: string): SyntaxCheckResult {
  return checkJavaScriptSyntax(content);
}

function checkPythonSyntax(content: string): SyntaxCheckResult {
  const lines = content.split('\n');
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;
  let inString = false;
  let stringChar = '';
  let inMultilineString = false;
  let multilineChar = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    for (let j = 0; j < line.length; j++) {
      const char = line[j];
      const prevChar = j > 0 ? line[j - 1] : '';

      if (inMultilineString) {
        if (char === multilineChar && prevChar === prevChar) {
          inMultilineString = false;
        }
        continue;
      }

      if (inString) {
        if (char === stringChar && prevChar !== '\\') {
          inString = false;
        }
        continue;
      }

      if (char === '#') {
        break;
      }

      if (char === '"' || char === "'") {
        if (line.substring(j, j + 3) === '"""' || line.substring(j, j + 3) === "'''") {
          inMultilineString = true;
          multilineChar = char;
          j += 2;
        } else {
          inString = true;
          stringChar = char;
        }
        continue;
      }

      switch (char) {
        case '(': parenDepth++; break;
        case ')': parenDepth--; break;
        case '[': bracketDepth++; break;
        case ']': bracketDepth--; break;
        case '{': braceDepth++; break;
        case '}': braceDepth--; break;
      }

      if (parenDepth < 0 || bracketDepth < 0 || braceDepth < 0) {
        return {
          valid: false,
          error: `Python syntax error: unbalanced brackets on line ${i + 1}`,
        };
      }
    }

    if (parenDepth !== 0 || bracketDepth !== 0 || braceDepth !== 0) {
      continue;
    }
  }

  if (parenDepth !== 0) {
    return { valid: false, error: `Python syntax error: unclosed parenthesis` };
  }
  if (bracketDepth !== 0) {
    return { valid: false, error: `Python syntax error: unclosed bracket` };
  }
  if (braceDepth !== 0) {
    return { valid: false, error: `Python syntax error: unclosed brace` };
  }

  return { valid: true };
}

function checkSyntax(path: string, content: string): SyntaxCheckResult {
  const ext = getExtension(path);

  switch (ext) {
    case 'js':
    case 'mjs':
    case 'cjs':
    case 'jsx':
      return checkJavaScriptSyntax(content);

    case 'ts':
    case 'tsx':
    case 'mts':
    case 'cts':
      return checkTypeScriptSyntax(content);

    case 'py':
    case 'pyw':
      return checkPythonSyntax(content);

    default:
      return { valid: true };
  }
}

export function validateContent(
  files: ExtractedFile[],
  options: { minCodeDensity?: number; checkSyntax?: boolean } = {}
): ContentValidationResult {
  const minCodeDensity = options.minCodeDensity ?? 0.4;
  const checkSyntaxEnabled = options.checkSyntax ?? true;

  const errors: DELValidationError[] = [];
  const validFiles: ExtractedFile[] = [];
  const rejectedFiles: Array<{ path: string; reason: string; code: DELErrorCode }> = [];

  for (const file of files) {
    const { path, content } = file;

    const placeholders = detectPlaceholders(content);
    if (placeholders.length > 0) {
      rejectedFiles.push({
        path,
        reason: `Placeholders detected: ${placeholders.join(', ')}`,
        code: DELErrorCode.PLACEHOLDER_DETECTED,
      });
      errors.push({
        code: DELErrorCode.PLACEHOLDER_DETECTED,
        message: `Placeholders detected in ${path}: ${placeholders.join(', ')}`,
        context: content.substring(0, 100),
        stage: 'content',
        filePath: path,
      });
      continue;
    }

    if (isDescriptionContent(content)) {
      rejectedFiles.push({
        path,
        reason: 'Content appears to be a description, not actual code',
        code: DELErrorCode.PLACEHOLDER_DETECTED,
      });
      errors.push({
        code: DELErrorCode.PLACEHOLDER_DETECTED,
        message: `Content in ${path} appears to be a description rather than code`,
        context: content.substring(0, 100),
        stage: 'content',
        filePath: path,
      });
      continue;
    }

    const codeDensity = calculateCodeDensity(content);
    if (codeDensity < minCodeDensity) {
      rejectedFiles.push({
        path,
        reason: `Code density too low: ${Math.round(codeDensity * 100)}% (min: ${Math.round(minCodeDensity * 100)}%)`,
        code: DELErrorCode.LOW_CODE_DENSITY,
      });
      errors.push({
        code: DELErrorCode.LOW_CODE_DENSITY,
        message: `Code density in ${path} is ${Math.round(codeDensity * 100)}%, below minimum of ${Math.round(minCodeDensity * 100)}%`,
        context: `Density: ${codeDensity}`,
        stage: 'content',
        filePath: path,
      });
      continue;
    }

    if (checkSyntaxEnabled) {
      const syntaxResult = checkSyntax(path, content);
      if (!syntaxResult.valid) {
        rejectedFiles.push({
          path,
          reason: syntaxResult.error || 'Syntax error',
          code: DELErrorCode.SYNTAX_ERROR,
        });
        errors.push({
          code: DELErrorCode.SYNTAX_ERROR,
          message: syntaxResult.error || `Syntax error in ${path}`,
          context: content.substring(0, 200),
          stage: 'content',
          filePath: path,
        });
        continue;
      }
    }

    validFiles.push({ path, content });
  }

  return {
    valid: validFiles.length > 0,
    errors,
    validFiles,
    rejectedFiles,
  };
}

export function calculateFileHash(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}
