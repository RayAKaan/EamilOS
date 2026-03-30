import { ArtifactValidationError } from '../errors.js';
import { detectSecrets } from '../utils/security.js';

export interface ValidationRule {
  name: string;
  validate: (content: string, filePath: string) => ValidationResult;
}

export interface ValidationResult {
  passed: boolean;
  error?: string;
  warnings?: string[];
}

export interface ValidationContext {
  projectId: string;
  taskId: string;
  expectedArtifacts?: string[];
  language?: string;
}

const languageExtensions: Record<string, string[]> = {
  typescript: ['ts', 'tsx'],
  javascript: ['js', 'jsx', 'mjs'],
  python: ['py'],
  rust: ['rs'],
  go: ['go'],
  java: ['java'],
  csharp: ['cs'],
  cpp: ['cpp', 'cc', 'cxx', 'hpp'],
  c: ['c', 'h'],
  ruby: ['rb'],
  php: ['php'],
  html: ['html', 'htm'],
  css: ['css', 'scss', 'sass', 'less'],
  sql: ['sql'],
  json: ['json'],
  yaml: ['yaml', 'yml'],
  markdown: ['md', 'markdown'],
  shell: ['sh', 'bash', 'zsh'],
};

const emptyContentRule: ValidationRule = {
  name: 'empty_content',
  validate: (content: string) => ({
    passed: content.trim().length > 0,
    error: 'File content is empty or contains only whitespace',
  }),
};

const minLengthRules: Record<string, ValidationRule> = {
  typescript: {
    name: 'min_length_typescript',
    validate: (content: string) => ({
      passed: content.length >= 50,
      error: 'TypeScript file is suspiciously short (expected at least 50 characters)',
    }),
  },
  python: {
    name: 'min_length_python',
    validate: (content: string) => ({
      passed: content.length >= 30,
      error: 'Python file is suspiciously short (expected at least 30 characters)',
    }),
  },
  shell: {
    name: 'min_length_shell',
    validate: (content: string) => ({
      passed: content.length >= 20,
      error: 'Shell script is suspiciously short (expected at least 20 characters)',
    }),
  },
};

const secretDetectionRule: ValidationRule = {
  name: 'secret_detection',
  validate: (content: string) => {
    const detected = detectSecrets(content);
    return {
      passed: !detected.found,
      error: detected.found ? `Potential secrets detected: ${detected.patterns.join(', ')}` : undefined,
      warnings: detected.found ? [`Content contains potential secrets: ${detected.patterns.join(', ')}`] : undefined,
    };
  },
};

const syntaxIndicatorRule: ValidationRule = {
  name: 'syntax_indicators',
  validate: (content: string, filePath: string) => {
    const ext = filePath.split('.').pop()?.toLowerCase();

    if (ext === 'ts' || ext === 'tsx') {
      const hasCode = /[;{}()=>]|function|const |let |var |class |interface |export/.test(content);
      return {
        passed: hasCode,
        error: 'TypeScript file does not appear to contain valid code',
      };
    }

    if (ext === 'py') {
      const hasCode = /def |class |import |from |if __name__|print\(|#/.test(content);
      return {
        passed: hasCode,
        error: 'Python file does not appear to contain valid code',
      };
    }

    if (ext === 'js' || ext === 'jsx' || ext === 'mjs') {
      const hasCode = /[;{}()=>]|function |const |let |var |class |export/.test(content);
      return {
        passed: hasCode,
        error: 'JavaScript file does not appear to contain valid code',
      };
    }

    return { passed: true };
  },
};

const shebangRule: ValidationRule = {
  name: 'shebang',
  validate: (content: string, filePath: string) => {
    if (filePath.endsWith('.sh') || filePath.endsWith('.bash')) {
      const hasShebang = content.startsWith('#!/');
      return {
        passed: hasShebang,
        error: 'Shell script missing shebang line',
      };
    }
    return { passed: true };
  },
};

export class ArtifactValidator {
  private rules: ValidationRule[] = [
    emptyContentRule,
    secretDetectionRule,
    syntaxIndicatorRule,
    shebangRule,
  ];
  private languageSpecificRules: Map<string, ValidationRule[]> = new Map();

  constructor() {
    for (const [lang, exts] of Object.entries(languageExtensions)) {
      const rule = minLengthRules[lang];
      if (rule) {
        for (const ext of exts) {
          const rules = this.languageSpecificRules.get(ext) ?? [];
          rules.push(rule);
          this.languageSpecificRules.set(ext, rules);
        }
      }
    }
  }

  addRule(rule: ValidationRule): void {
    this.rules.push(rule);
  }

  validate(content: string, filePath: string, _context?: Partial<ValidationContext>): ValidationResult {
    const allRules = [...this.rules];

    const ext = filePath.split('.').pop()?.toLowerCase();
    if (ext) {
      const specificRules = this.languageSpecificRules.get(ext);
      if (specificRules) {
        allRules.push(...specificRules);
      }
    }

    const errors: string[] = [];
    const warnings: string[] = [];

    for (const rule of allRules) {
      const result = rule.validate(content, filePath);

      if (!result.passed && result.error) {
        errors.push(`[${rule.name}] ${result.error}`);
      }

      if (result.warnings) {
        warnings.push(...result.warnings.map((w) => `[${rule.name}] ${w}`));
      }
    }

    if (errors.length > 0) {
      return {
        passed: false,
        error: errors.join('; '),
        warnings: warnings.length > 0 ? warnings : undefined,
      };
    }

    return {
      passed: true,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }

  validateMany(
    artifacts: Array<{ path: string; content: string }>,
    context?: Partial<ValidationContext>
  ): Map<string, ValidationResult> {
    const results = new Map<string, ValidationResult>();

    for (const artifact of artifacts) {
      results.set(artifact.path, this.validate(artifact.content, artifact.path, context));
    }

    return results;
  }
}

export function validateArtifact(
  content: string,
  filePath: string,
  context?: Partial<ValidationContext>
): ValidationResult {
  const validator = new ArtifactValidator();
  return validator.validate(content, filePath, context);
}

export function validateArtifactOrThrow(
  content: string,
  filePath: string,
  context?: Partial<ValidationContext>
): void {
  const result = validateArtifact(content, filePath, context);

  if (!result.passed) {
    throw new ArtifactValidationError(
      result.error!,
      context?.taskId,
      [filePath],
      { warnings: result.warnings }
    );
  }
}
