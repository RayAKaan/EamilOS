import { DELErrorCode, DELValidationError } from './types.js';
import { ClassifiedError, FailureType } from './stateful-types.js';

const ERROR_TO_FAILURE_TYPE: Record<DELErrorCode, FailureType> = {
  [DELErrorCode.EXTRACTION_FAILURE]: 'format_error',
  [DELErrorCode.SCHEMA_MISMATCH]: 'schema_error',
  [DELErrorCode.PLACEHOLDER_DETECTED]: 'content_error',
  [DELErrorCode.LOW_CODE_DENSITY]: 'content_error',
  [DELErrorCode.SYNTAX_ERROR]: 'content_error',
  [DELErrorCode.PATH_TRAVERSAL]: 'security_error',
  [DELErrorCode.SECRET_DETECTED]: 'security_error',
};

const NON_RETRYABLE_ERRORS: Set<DELErrorCode> = new Set([
  DELErrorCode.PATH_TRAVERSAL,
  DELErrorCode.SECRET_DETECTED,
]);

const ERROR_SUGGESTIONS: Record<FailureType, string> = {
  format_error: 'Use explicit JSON format with {"files": [...]} structure. Remove conversational prefixes.',
  schema_error: 'Ensure JSON matches schema: {"files": [{"path": string, "content": string}]}. No extra keys.',
  content_error: 'Provide complete, working code. Remove TODOs, placeholders, and incomplete implementations.',
  security_error: 'Path traversal or secret detection. Check file paths and remove any detected secrets.',
  write_error: 'File system error during write. Check permissions and disk space.',
};

const ERROR_CONTEXT_HINTS: Record<DELErrorCode, string> = {
  [DELErrorCode.EXTRACTION_FAILURE]: 'The JSON could not be parsed. Try wrapping in ```json block.',
  [DELErrorCode.SCHEMA_MISMATCH]: 'JSON structure invalid. Ensure "files" is an array of {path, content} objects.',
  [DELErrorCode.PLACEHOLDER_DETECTED]: 'Code contains TODO/FIXME/placeholder. Replace with actual implementation.',
  [DELErrorCode.LOW_CODE_DENSITY]: 'Code has too few actual code lines. Ensure >40% is real code, not comments.',
  [DELErrorCode.SYNTAX_ERROR]: 'Code has syntax errors. Fix syntax for the file type.',
  [DELErrorCode.PATH_TRAVERSAL]: 'Path contains ".." or absolute path. Use relative paths only.',
  [DELErrorCode.SECRET_DETECTED]: 'API key or secret detected. Remove or mask sensitive data.',
};

export function classifyError(error: DELValidationError): ClassifiedError {
  const failureType = ERROR_TO_FAILURE_TYPE[error.code] || 'format_error';
  const retryable = !NON_RETRYABLE_ERRORS.has(error.code);
  const suggestedStrategy = ERROR_CONTEXT_HINTS[error.code] || ERROR_SUGGESTIONS[failureType];

  return {
    ...error,
    failureType,
    retryable,
    suggestedStrategy,
  };
}

export function classifyErrors(errors: DELValidationError[]): ClassifiedError[] {
  return errors.map(classifyError);
}

export function getFailureType(error: DELValidationError): FailureType {
  return ERROR_TO_FAILURE_TYPE[error.code] || 'format_error';
}

export function isRetryable(error: DELValidationError): boolean {
  return !NON_RETRYABLE_ERRORS.has(error.code);
}

export function isSecurityFailure(error: DELValidationError): boolean {
  return error.code === DELErrorCode.PATH_TRAVERSAL || error.code === DELErrorCode.SECRET_DETECTED;
}

export function filterRetryableErrors(errors: ClassifiedError[]): ClassifiedError[] {
  return errors.filter(e => e.retryable);
}

export function filterNonRetryableErrors(errors: ClassifiedError[]): ClassifiedError[] {
  return errors.filter(e => !e.retryable);
}

export function groupErrorsByType(errors: ClassifiedError[]): Record<FailureType, ClassifiedError[]> {
  const grouped: Partial<Record<FailureType, ClassifiedError[]>> = {};

  for (const error of errors) {
    if (!grouped[error.failureType]) {
      grouped[error.failureType] = [];
    }
    grouped[error.failureType]!.push(error);
  }

  return grouped as Record<FailureType, ClassifiedError[]>;
}

export function getMostSevereError(errors: ClassifiedError[]): ClassifiedError | null {
  if (errors.length === 0) return null;

  const severityOrder: FailureType[] = ['security_error', 'write_error', 'schema_error', 'content_error', 'format_error'];

  for (const severity of severityOrder) {
    const found = errors.find(e => e.failureType === severity);
    if (found) return found;
  }

  return errors[0];
}

export function getSuggestedRepairStrategy(errors: ClassifiedError[]): string {
  if (errors.length === 0) {
    return 'No errors to repair.';
  }

  const nonRetryable = filterNonRetryableErrors(errors);
  if (nonRetryable.length > 0) {
    return 'Security errors detected. Cannot auto-repair. Manual intervention required.';
  }

  const grouped = groupErrorsByType(errors);
  const strategies: string[] = [];

  if (grouped.format_error?.length) {
    strategies.push('Use strict JSON format: {"files": [...]} with markdown code block.');
  }
  if (grouped.schema_error?.length) {
    strategies.push('Enforce schema: each file must have non-empty "path" and "content".');
  }
  if (grouped.content_error?.length) {
    strategies.push('Remove placeholders. Provide complete implementations with >40% code density.');
  }

  return strategies.join(' ');
}
