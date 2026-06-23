import { ValidationResult, ValidationError, ValidationWarning } from '../schemas/structured-output.js';

interface LanguageValidator {
  validate(content: string, filePath: string): ValidationResult;
}

class PythonValidator implements LanguageValidator {
  validate(content: string, filePath: string): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      if (/^\s+\s+\s+/.test(line)) {
        errors.push({
          filePath,
          line: lineNum,
          message: 'Inconsistent indentation: mix of tabs and spaces',
          severity: 'error',
        });
      }

      if (line.includes('\t') && i > 0) {
        const prevLine = lines[i - 1];
        if (prevLine && !prevLine.includes('\t') && prevLine.match(/^\s{4}/)) {
          warnings.push({
            filePath,
            line: lineNum,
            message: 'Mixed tabs and spaces in indentation',
            severity: 'warning',
          });
        }
      }

      if (line.trim().startsWith('#') && line.trim().endsWith('#')) {
        errors.push({
          filePath,
          line: lineNum,
          message: 'Comment appears to be incomplete',
          severity: 'error',
        });
      }
    }

    const indentMatch = content.match(/^(\s+)/m);
    if (indentMatch && indentMatch[1].includes(' ') && indentMatch[1].length % 4 !== 0) {
      warnings.push({
        filePath,
        message: 'Indentation is not a multiple of 4 spaces',
        severity: 'warning',
      });
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }
}

class JavaScriptValidator implements LanguageValidator {
  validate(content: string, filePath: string): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      if (line.match(/['"]\s*$/)) {
        errors.push({
          filePath,
          line: lineNum,
          message: 'Unclosed string literal',
          severity: 'error',
        });
      }

      if (line.includes('function') && !line.includes('{') && !content.substring(content.indexOf(line)).includes('{')) {
        warnings.push({
          filePath,
          line: lineNum,
          message: 'Possible missing function body braces',
          severity: 'warning',
        });
      }
    }

    const openBraces = (content.match(/\{/g) || []).length;
    const closeBraces = (content.match(/\}/g) || []).length;
    if (openBraces !== closeBraces) {
      errors.push({
        filePath,
        message: `Mismatched braces: ${openBraces} open, ${closeBraces} close`,
        severity: 'error',
      });
    }

    const openParens = (content.match(/\(/g) || []).length;
    const closeParens = (content.match(/\)/g) || []).length;
    if (openParens !== closeParens) {
      errors.push({
        filePath,
        message: `Mismatched parentheses: ${openParens} open, ${closeParens} close`,
        severity: 'error',
      });
    }

    const openBrackets = (content.match(/\[/g) || []).length;
    const closeBrackets = (content.match(/\]/g) || []).length;
    if (openBrackets !== closeBrackets) {
      errors.push({
        filePath,
        message: `Mismatched brackets: ${openBrackets} open, ${closeBrackets} close`,
        severity: 'error',
      });
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }
}

class GoValidator implements LanguageValidator {
  validate(content: string, filePath: string): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    const tabLines = content.split('\n').filter(l => l.startsWith('\t'));
    if (tabLines.length > 0) {
      warnings.push({
        filePath,
        message: 'Code uses tabs - Go convention is tabs',
        severity: 'warning',
      });
    }

    const openBraces = (content.match(/\{/g) || []).length;
    const closeBraces = (content.match(/\}/g) || []).length;
    if (openBraces !== closeBraces) {
      errors.push({
        filePath,
        message: `Mismatched braces: ${openBraces} open, ${closeBraces} close`,
        severity: 'error',
      });
    }

    if (!content.includes('package ')) {
      errors.push({
        filePath,
        message: 'Missing package declaration',
        severity: 'error',
      });
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }
}

class RustValidator implements LanguageValidator {
  validate(content: string, filePath: string): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    const openBraces = (content.match(/\{/g) || []).length;
    const closeBraces = (content.match(/\}/g) || []).length;
    if (openBraces !== closeBraces) {
      errors.push({
        filePath,
        message: `Mismatched braces: ${openBraces} open, ${closeBraces} close`,
        severity: 'error',
      });
    }

    const openParens = (content.match(/\(/g) || []).length;
    const closeParens = (content.match(/\)/g) || []).length;
    if (openParens !== closeParens) {
      errors.push({
        filePath,
        message: `Mismatched parentheses: ${openParens} open, ${closeParens} close`,
        severity: 'error',
      });
    }

    if (!content.includes('fn ') && !content.includes('let ')) {
      warnings.push({
        filePath,
        message: 'No function or variable declarations found',
        severity: 'warning',
      });
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }
}

class GenericValidator implements LanguageValidator {
  validate(content: string, filePath: string): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    const openBraces = (content.match(/\{/g) || []).length;
    const closeBraces = (content.match(/\}/g) || []).length;
    if (openBraces !== closeBraces) {
      errors.push({
        filePath,
        message: `Mismatched braces: ${openBraces} open, ${closeBraces} close`,
        severity: 'error',
      });
    }

    const openParens = (content.match(/\(/g) || []).length;
    const closeParens = (content.match(/\)/g) || []).length;
    if (openParens !== closeParens) {
      errors.push({
        filePath,
        message: `Mismatched parentheses: ${openParens} open, ${closeParens} close`,
        severity: 'error',
      });
    }

    const openBrackets = (content.match(/\[/g) || []).length;
    const closeBrackets = (content.match(/\]/g) || []).length;
    if (openBrackets !== closeBrackets) {
      errors.push({
        filePath,
        message: `Mismatched brackets: ${openBrackets} open, ${closeBrackets} close`,
        severity: 'error',
      });
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }
}

export class CodeValidator {
  private validators: Map<string, LanguageValidator>;

  constructor() {
    this.validators = new Map([
      ['python', new PythonValidator()],
      ['py', new PythonValidator()],
      ['javascript', new JavaScriptValidator()],
      ['js', new JavaScriptValidator()],
      ['typescript', new JavaScriptValidator()],
      ['ts', new JavaScriptValidator()],
      ['tsx', new JavaScriptValidator()],
      ['jsx', new JavaScriptValidator()],
      ['go', new GoValidator()],
      ['rust', new RustValidator()],
      ['rs', new RustValidator()],
      ['java', new GenericValidator()],
      ['cpp', new GenericValidator()],
      ['c', new GenericValidator()],
    ]);
  }

  validate(content: string, filePath: string, language?: string): ValidationResult {
    const lang = language || this.inferLanguage(filePath);
    const validator = this.validators.get(lang.toLowerCase());

    if (validator) {
      return validator.validate(content, filePath);
    }

    return new GenericValidator().validate(content, filePath);
  }

  private inferLanguage(filePath: string): string {
    const ext = filePath.split('.').pop()?.toLowerCase() || '';
    return ext;
  }

  validateMultiple(files: Array<{ filePath: string; content: string; language?: string }>): ValidationResult {
    const allErrors: ValidationError[] = [];
    const allWarnings: ValidationWarning[] = [];

    for (const file of files) {
      const result = this.validate(file.content, file.filePath, file.language);
      allErrors.push(...result.errors);
      allWarnings.push(...result.warnings);
    }

    return {
      valid: allErrors.length === 0,
      errors: allErrors,
      warnings: allWarnings,
    };
  }
}

let globalValidator: CodeValidator | null = null;

export function getCodeValidator(): CodeValidator {
  if (!globalValidator) {
    globalValidator = new CodeValidator();
  }
  return globalValidator;
}

export function initCodeValidator(): CodeValidator {
  globalValidator = new CodeValidator();
  return globalValidator;
}
