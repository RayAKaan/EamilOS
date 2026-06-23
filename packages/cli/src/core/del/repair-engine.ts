import { DELValidationError, DELErrorCode, RetryContext, RepairPrompt, EscalationLevel } from './types.js';

export interface RepairResult {
  shouldRetry: boolean;
  shouldTerminate: boolean;
  terminationReason?: string;
  repairPrompt?: RepairPrompt;
  nextEscalationLevel?: EscalationLevel;
}

export interface DecomposedTask {
  filePath: string;
  task: string;
}

function determineNextEscalationLevel(current: EscalationLevel): EscalationLevel {
  switch (current) {
    case 'standard':
      return 'strict';
    case 'strict':
      return 'decompose';
    case 'decompose':
      return 'decompose';
    default:
      return 'standard';
  }
}

function generateStandardRepair(error: DELValidationError): RepairPrompt {
  const errorContext = formatErrorContext(error);

  return {
    systemInstruction: 'Output ONLY valid JSON. No explanations, no markdown, no conversational text.',
    correctionContext: `Your previous output failed validation:\n${errorContext}\n\nProvide ONLY the corrected JSON response with exactly this schema: {"files": [{"path": "relative/path/to/file.ts", "content": "file content"}]}\nDo not include any other text.`,
  };
}

function generateStrictRepair(error: DELValidationError): RepairPrompt {
  const errorContext = formatErrorContext(error);
  const schemaInstruction = getSchemaInstruction(error);

  return {
    systemInstruction: 'You must output ONLY a valid JSON object. No markdown, no explanations, no conversational text.',
    correctionContext: `Validation Error:\n${errorContext}\n\n${schemaInstruction}\n\nRules:\n1. Output a JSON object with EXACTLY this structure: {"files": [{"path": string, "content": string}]}\n2. "files" MUST be a non-empty array\n3. Each file MUST have "path" (non-empty string with valid extension) and "content" (non-empty string with actual code)\n4. No TODO, FIXME, or placeholder content\n5. Code must have >40% actual code (not comments/blank lines)\n6. No explanatory text before or after the JSON\n\nOutput ONLY the JSON object:`,
  };
}

function generateDecomposeRepair(
  allErrors: DELValidationError[]
): { prompts: RepairPrompt[]; decomposition: DecomposedTask[] } {
  const fileErrors = allErrors.filter(e => e.filePath);
  const uniqueFiles = [...new Set(fileErrors.map(e => e.filePath))];

  const decomposition: DecomposedTask[] = uniqueFiles.map(filePath => ({
    filePath: filePath!,
    task: `Generate complete, production-ready code for ${filePath}`,
  }));

  const mainPrompt: RepairPrompt = {
    systemInstruction: 'You must output ONLY valid JSON. No markdown, no explanations.',
    correctionContext: `Your output failed validation. Instead of generating all files at once, I will ask you to generate files one at a time.\n\nFocus on providing complete, working code for each file. No placeholders, no TODOs, no incomplete implementations.`,
  };

  const filePrompts: RepairPrompt[] = decomposition.map(({ filePath }) => ({
    systemInstruction: 'Output ONLY valid JSON for a single file.',
    correctionContext: `Generate ONLY the file "${filePath}". Provide complete, production-ready code with:\n1. No TODO or FIXME comments\n2. No placeholder content\n3. No "implementation here" or similar\n4. Full code with all imports and dependencies\n\nOutput ONLY this JSON: {"files": [{"path": "${filePath}", "content": "complete code here"}]}`,
  }));

  return {
    prompts: [mainPrompt, ...filePrompts],
    decomposition,
  };
}

function formatErrorContext(error: DELValidationError): string {
  return [
    `Error Code: ${error.code}`,
    `Stage: ${error.stage}`,
    `Message: ${error.message}`,
    error.context ? `Context: ${error.context.substring(0, 200)}` : '',
    error.filePath ? `File: ${error.filePath}` : '',
  ].filter(Boolean).join('\n');
}

function getSchemaInstruction(error: DELValidationError): string {
  switch (error.code) {
    case DELErrorCode.EXTRACTION_FAILURE:
      return 'The JSON could not be parsed. Ensure proper JSON syntax with matching braces and brackets.';
    case DELErrorCode.SCHEMA_MISMATCH:
      return 'The JSON structure does not match. Ensure {"files": [{"path": string, "content": string}]} format.';
    case DELErrorCode.PLACEHOLDER_DETECTED:
      return 'Content contains placeholders (TODO, FIXME, etc.). Replace with actual implementation.';
    case DELErrorCode.LOW_CODE_DENSITY:
      return 'Content has too few lines of actual code. Ensure >40% of content is code, not comments.';
    case DELErrorCode.SYNTAX_ERROR:
      return 'The code has syntax errors. Ensure valid syntax for the file type.';
    default:
      return 'Fix the validation error and output valid JSON.';
  }
}

export class RepairEngine {
  private maxAttempts: number;

  constructor(maxAttempts: number = 3) {
    this.maxAttempts = maxAttempts;
  }

  analyze(errors: DELValidationError[]): RepairResult {
    if (errors.length === 0) {
      return {
        shouldRetry: false,
        shouldTerminate: false,
      };
    }

    const hasSecurityFailure = errors.some(
      e => e.code === DELErrorCode.PATH_TRAVERSAL ||
           e.code === DELErrorCode.SECRET_DETECTED
    );

    if (hasSecurityFailure) {
      return {
        shouldRetry: false,
        shouldTerminate: true,
        terminationReason: 'Security validation failed. Path traversal or secret detection cannot be retried.',
      };
    }

    return {
      shouldRetry: true,
      shouldTerminate: false,
    };
  }

  createRetryContext(
    attempt: number,
    failureHistory: DELValidationError[],
    currentEscalationLevel: EscalationLevel
  ): RetryContext {
    return {
      attempt,
      maxAttempts: this.maxAttempts,
      failureHistory,
      escalationLevel: currentEscalationLevel,
    };
  }

  generateRepairPrompt(
    errors: DELValidationError[],
    context: RetryContext
  ): RepairResult {
    if (context.attempt >= this.maxAttempts) {
      return {
        shouldRetry: false,
        shouldTerminate: true,
        terminationReason: `Max attempts (${this.maxAttempts}) reached without successful validation.`,
      };
    }

    const securityFailure = errors.some(
      e => e.code === DELErrorCode.PATH_TRAVERSAL ||
           e.code === DELErrorCode.SECRET_DETECTED
    );

    if (securityFailure) {
      return {
        shouldRetry: false,
        shouldTerminate: true,
        terminationReason: 'Security validation failed. Cannot retry security failures.',
      };
    }

    const primaryError = errors[0];
    const nextLevel = determineNextEscalationLevel(context.escalationLevel);

    switch (context.escalationLevel) {
      case 'standard':
        return {
          shouldRetry: true,
          shouldTerminate: false,
          repairPrompt: generateStandardRepair(primaryError),
          nextEscalationLevel: nextLevel,
        };

      case 'strict':
        return {
          shouldRetry: true,
          shouldTerminate: false,
          repairPrompt: generateStrictRepair(primaryError),
          nextEscalationLevel: nextLevel,
        };

      case 'decompose':
        const { prompts } = generateDecomposeRepair(errors);
        return {
          shouldRetry: true,
          shouldTerminate: false,
          repairPrompt: prompts[1] || prompts[0],
          nextEscalationLevel: nextLevel,
        };

      default:
        return {
          shouldRetry: true,
          shouldTerminate: false,
          repairPrompt: generateStandardRepair(primaryError),
          nextEscalationLevel: 'strict',
        };
    }
  }

  getEscalationDescription(level: EscalationLevel): string {
    switch (level) {
      case 'standard':
        return 'Appending error context to prompt';
      case 'strict':
        return 'Enforcing strict schema constraints';
      case 'decompose':
        return 'Decomposing into single-file tasks';
      default:
        return 'Unknown escalation level';
    }
  }
}

export function createRepairEngine(maxAttempts?: number): RepairEngine {
  return new RepairEngine(maxAttempts);
}
