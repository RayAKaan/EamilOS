import type { ParseResult } from '../parsers/ResponseParser.js';

export interface ValidationRule {
  name: string;
  validate: (result: ParseResult) => ValidationResult;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  sanitized?: any;
}

export interface GuardrailConfig {
  strictMode: boolean;
  maxFileSize: number;
  allowedExtensions?: string[];
  blockedExtensions?: string[];
  maxFiles: number;
  requireSummary: boolean;
  allowEmptyFiles: boolean;
}

export class OutputGuardrails {
  private rules: ValidationRule[] = [];
  private config: GuardrailConfig;

  constructor(config?: Partial<GuardrailConfig>) {
    this.config = {
      strictMode: config?.strictMode ?? false,
      maxFileSize: config?.maxFileSize ?? 1_000_000,
      allowedExtensions: config?.allowedExtensions,
      blockedExtensions: config?.blockedExtensions,
      maxFiles: config?.maxFiles ?? 50,
      requireSummary: config?.requireSummary ?? false,
      allowEmptyFiles: config?.allowEmptyFiles ?? true,
    };
    
    this.registerDefaultRules();
  }

  private registerDefaultRules(): void {
    this.addRule({
      name: 'hasFiles',
      validate: (result) => {
        if (!result.files || result.files.length === 0) {
          return {
            valid: false,
            errors: ['No files in response'],
            warnings: [],
          };
        }
        return { valid: true, errors: [], warnings: [] };
      },
    });

    this.addRule({
      name: 'maxFiles',
      validate: (result) => {
        if (result.files.length > this.config.maxFiles) {
          return {
            valid: false,
            errors: [`Too many files: ${result.files.length} > ${this.config.maxFiles}`],
            warnings: [],
          };
        }
        return { valid: true, errors: [], warnings: [] };
      },
    });

    this.addRule({
      name: 'fileSize',
      validate: (result) => {
        const oversizedFiles = result.files.filter(
          f => typeof f.content === 'string' && f.content.length > this.config.maxFileSize
        );
        
        if (oversizedFiles.length > 0) {
          return {
            valid: false,
            errors: [
              `${oversizedFiles.length} file(s) exceed max size of ${this.config.maxFileSize} chars`,
            ],
            warnings: [],
          };
        }
        return { valid: true, errors: [], warnings: [] };
      },
    });

    this.addRule({
      name: 'validPaths',
      validate: (result) => {
        const invalidPaths = result.files.filter(
          f => !f.path || f.path.trim() === '' || f.path.startsWith('/')
        );
        
        if (invalidPaths.length > 0) {
          return {
            valid: false,
            errors: [`${invalidPaths.length} file(s) have invalid paths`],
            warnings: [],
          };
        }
        return { valid: true, errors: [], warnings: [] };
      },
    });

    if (this.config.allowedExtensions) {
      this.addRule({
        name: 'allowedExtensions',
        validate: (result) => {
          const invalidFiles = result.files.filter((f) => {
            const ext = '.' + f.path.split('.').pop()?.toLowerCase();
            return !this.config.allowedExtensions!.includes(ext);
          });
          
          if (invalidFiles.length > 0) {
            return {
              valid: false,
              errors: [`${invalidFiles.length} file(s) have disallowed extensions`],
              warnings: [],
            };
          }
          return { valid: true, errors: [], warnings: [] };
        },
      });
    }

    if (this.config.blockedExtensions) {
      this.addRule({
        name: 'blockedExtensions',
        validate: (result) => {
          const blockedFiles = result.files.filter((f) => {
            const ext = '.' + f.path.split('.').pop()?.toLowerCase();
            return this.config.blockedExtensions!.includes(ext);
          });
          
          if (blockedFiles.length > 0) {
            return {
              valid: false,
              errors: [`${blockedFiles.length} file(s) have blocked extensions`],
              warnings: [],
            };
          }
          return { valid: true, errors: [], warnings: [] };
        },
      });
    }

    this.addRule({
      name: 'hasContent',
      validate: (result) => {
        const emptyFiles = result.files.filter(
          f => !f.content || f.content.trim() === ''
        );
        
        if (emptyFiles.length > 0 && !this.config.allowEmptyFiles) {
          return {
            valid: false,
            errors: [`${emptyFiles.length} file(s) are empty`],
            warnings: [],
          };
        }
        return { valid: true, errors: [], warnings: [] };
      },
    });
  }

  addRule(rule: ValidationRule): void {
    this.rules.push(rule);
  }

  removeRule(name: string): boolean {
    const index = this.rules.findIndex(r => r.name === name);
    if (index !== -1) {
      this.rules.splice(index, 1);
      return true;
    }
    return false;
  }

  validate(result: ParseResult): ValidationResult {
    const allErrors: string[] = [];
    const allWarnings: string[] = [];

    for (const rule of this.rules) {
      const ruleResult = rule.validate(result);
      allErrors.push(...ruleResult.errors);
      allWarnings.push(...ruleResult.warnings);
    }

    return {
      valid: this.config.strictMode ? allErrors.length === 0 : true,
      errors: allErrors,
      warnings: allWarnings,
    };
  }

  sanitize(result: ParseResult): ParseResult {
    const sanitized = {
      ...result,
      files: result.files
        .filter(f => f.path && f.path.trim() !== '')
        .map(f => ({
          ...f,
          path: f.path.trim(),
          content: typeof f.content === 'string' ? f.content.trim() : f.content,
        }))
        .filter(f => {
          if (!this.config.allowEmptyFiles) {
            return f.content && String(f.content).trim() !== '';
          }
          return true;
        }),
    };

    return sanitized;
  }

  getConfig(): GuardrailConfig {
    return { ...this.config };
  }

  updateConfig(config: Partial<GuardrailConfig>): void {
    this.config = { ...this.config, ...config };
  }

  getRules(): string[] {
    return this.rules.map(r => r.name);
  }
}
