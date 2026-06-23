import { createHash } from 'crypto';
import {
  DELConfig,
  DEFAULT_DEL_CONFIG,
  ExecutionReceipt,
  ExtractedPayload,
  GuaranteedFile,
  RawProviderOutput,
  DELValidationError,
  DELErrorCode,
  EscalationLevel,
  SafePath,
  brandValidatedCode,
} from './types.js';
import { extract } from './extractor.js';
import { validateSchema } from './schema-validator.js';
import { validateContent } from './content-validator.js';
import { validateSecurity } from './security-validator.js';
import { writeAtomically } from './atomic-writer.js';
import { RepairEngine, createRepairEngine } from './repair-engine.js';

interface ExecutionCallbacks {
  onStageStart?: (stage: string, context: ExecutionContext) => void;
  onStageComplete?: (stage: string, context: ExecutionContext) => void;
  onStageError?: (stage: string, error: DELValidationError, context: ExecutionContext) => void;
  onAttempt?: (attempt: number, context: ExecutionContext) => void;
  onTermination?: (reason: string, context: ExecutionContext) => void;
}

export interface ExecutionContext {
  rawOutput: RawProviderOutput;
  extractedPayload?: ExtractedPayload;
  schemaValidatedFiles?: Array<{ path: string; content: string }>;
  contentValidatedFiles?: Array<{ path: string; content: string }>;
  safeFiles?: Array<{ path: SafePath; content: string }>;
  allErrors: DELValidationError[];
  currentEscalationLevel: EscalationLevel;
  attempt: number;
}

export interface ExecutionResult {
  success: boolean;
  receipt?: ExecutionReceipt;
  errors: DELValidationError[];
  context: ExecutionContext;
  terminationReason?: string;
}

export class DELExecutor {
  private config: DELConfig;
  private repairEngine: RepairEngine;

  constructor(config: Partial<DELConfig> = {}) {
    this.config = { ...DEFAULT_DEL_CONFIG, ...config };
    this.repairEngine = createRepairEngine(this.config.maxAttempts);
  }

  async execute(
    rawOutput: RawProviderOutput,
    callbacks?: ExecutionCallbacks
  ): Promise<ExecutionResult> {
    const startTime = Date.now();
    const initialContext: ExecutionContext = {
      rawOutput,
      allErrors: [],
      currentEscalationLevel: 'standard',
      attempt: 1,
    };

    let context = initialContext;

    for (let attempt = 1; attempt <= this.config.maxAttempts; attempt++) {
      context.attempt = attempt;
      callbacks?.onAttempt?.(attempt, context);

      const stageResult = await this.executePipeline(context, callbacks);

      if (stageResult.success) {
        const receipt = stageResult.receipt!;
        receipt.durationMs = Date.now() - startTime;
        receipt.attemptCount = attempt;

        return {
          success: true,
          receipt,
          errors: context.allErrors,
          context,
        };
      }

      context.allErrors.push(...stageResult.errors);
      context.extractedPayload = stageResult.extractedPayload;
      context.schemaValidatedFiles = stageResult.schemaValidatedFiles;
      context.contentValidatedFiles = stageResult.contentValidatedFiles;
      context.safeFiles = stageResult.safeFiles;

      const repairResult = this.repairEngine.analyze(stageResult.errors);

      if (repairResult.shouldTerminate) {
        callbacks?.onTermination?.(repairResult.terminationReason || 'Unknown termination', context);

        return {
          success: false,
          errors: context.allErrors,
          context,
          terminationReason: repairResult.terminationReason,
        };
      }

      const retryContext = this.repairEngine.createRetryContext(
        attempt,
        context.allErrors,
        context.currentEscalationLevel
      );

      const repairPrompt = this.repairEngine.generateRepairPrompt(stageResult.errors, retryContext);

      if (repairPrompt.shouldTerminate) {
        callbacks?.onTermination?.(repairPrompt.terminationReason || 'Max attempts reached', context);

        return {
          success: false,
          errors: context.allErrors,
          context,
          terminationReason: repairPrompt.terminationReason,
        };
      }

      if (repairPrompt.nextEscalationLevel) {
        context.currentEscalationLevel = repairPrompt.nextEscalationLevel;
      }
    }

    callbacks?.onTermination?.(`Max attempts (${this.config.maxAttempts}) reached`, context);

    return {
      success: false,
      errors: context.allErrors,
      context,
      terminationReason: `Max attempts (${this.config.maxAttempts}) reached without successful validation`,
    };
  }

  private async executePipeline(
    context: ExecutionContext,
    callbacks?: ExecutionCallbacks
  ): Promise<{
    success: boolean;
    receipt?: ExecutionReceipt;
    errors: DELValidationError[];
    extractedPayload?: ExtractedPayload;
    schemaValidatedFiles?: Array<{ path: string; content: string }>;
    contentValidatedFiles?: Array<{ path: string; content: string }>;
    safeFiles?: Array<{ path: SafePath; content: string }>;
  }> {
    const errors: DELValidationError[] = [];

    callbacks?.onStageStart?.('extraction', context);

    const extractResult = extract(context.rawOutput.rawText);

    if (!extractResult.ok) {
      errors.push(extractResult.error);
      callbacks?.onStageError?.('extraction', extractResult.error, context);
      callbacks?.onStageComplete?.('extraction', context);

      return {
        success: false,
        errors,
      };
    }

    const payload = extractResult.value;
    callbacks?.onStageComplete?.('extraction', { ...context, extractedPayload: payload });

    callbacks?.onStageStart?.('schema', { ...context, extractedPayload: payload });

    const schemaResult = validateSchema(payload, this.config);

    if (!schemaResult.ok || !schemaResult.value.valid) {
      const schemaError = schemaResult.ok ? schemaResult.value.errors[0] : schemaResult.error;
      if (schemaError) {
        errors.push(schemaError);
        callbacks?.onStageError?.('schema', schemaError, context);
      }
      callbacks?.onStageComplete?.('schema', context);

      return {
        success: false,
        errors,
        extractedPayload: payload,
      };
    }

    const schemaValidatedFiles = schemaResult.value.validFiles;
    callbacks?.onStageComplete?.('schema', { ...context, schemaValidatedFiles });

    callbacks?.onStageStart?.('content', { ...context, schemaValidatedFiles });

    const contentResult = validateContent(schemaValidatedFiles, {
      minCodeDensity: this.config.allowDescriptiveContent ? 0.3 : 0.4,
      checkSyntax: true,
    });

    if (!contentResult.valid) {
      errors.push(...contentResult.errors);
      contentResult.errors.forEach(e => callbacks?.onStageError?.('content', e, context));
      callbacks?.onStageComplete?.('content', context);

      return {
        success: false,
        errors,
        extractedPayload: payload,
        schemaValidatedFiles,
      };
    }

    const contentValidatedFiles = contentResult.validFiles;
    callbacks?.onStageComplete?.('content', { ...context, contentValidatedFiles });

    callbacks?.onStageStart?.('security', { ...context, contentValidatedFiles });

    const securityResult = validateSecurity(contentValidatedFiles, this.config);

    if (!securityResult.valid) {
      errors.push(...securityResult.errors);
      securityResult.errors.forEach(e => callbacks?.onStageError?.('security', e, context));
      callbacks?.onStageComplete?.('security', context);

      return {
        success: false,
        errors,
        extractedPayload: payload,
        schemaValidatedFiles,
        contentValidatedFiles,
      };
    }

    const safeFiles = securityResult.safeFiles;
    callbacks?.onStageComplete?.('security', { ...context, safeFiles });

    callbacks?.onStageStart?.('write', { ...context, safeFiles });

    const writeResult = writeAtomically(safeFiles, this.config.workspaceRoot, this.config);

    if (!writeResult.success) {
      errors.push({
        code: DELErrorCode.EXTRACTION_FAILURE,
        message: `Write failed: ${writeResult.errors.join(', ')}`,
        context: writeResult.errors.join('; '),
        stage: 'write',
      });
      callbacks?.onStageError?.('write', errors[errors.length - 1], context);
      callbacks?.onStageComplete?.('write', context);

      return {
        success: false,
        errors,
        extractedPayload: payload,
        schemaValidatedFiles,
        contentValidatedFiles,
        safeFiles,
      };
    }

    callbacks?.onStageComplete?.('write', { ...context, safeFiles });

    const guaranteedFiles: GuaranteedFile[] = safeFiles.map(f => ({
      path: f.path,
      content: brandValidatedCode(f.content),
      hash: createHash('sha256').update(f.content, 'utf-8').digest('hex'),
    }));

    const receipt: ExecutionReceipt = {
      success: true,
      filesWritten: guaranteedFiles,
      bytesWritten: writeResult.receipt.bytesWritten,
      durationMs: writeResult.receipt.durationMs,
      errors: [],
      extractionStrategy: payload.extractionStrategy,
      attemptCount: context.attempt,
    };

    return {
      success: true,
      receipt,
      errors: [],
      extractedPayload: payload,
      schemaValidatedFiles,
      contentValidatedFiles,
      safeFiles,
    };
  }

  getConfig(): DELConfig {
    return { ...this.config };
  }
}

export function createDELExecutor(config?: Partial<DELConfig>): DELExecutor {
  return new DELExecutor(config);
}

export async function executeDEL(
  rawOutput: RawProviderOutput,
  config?: Partial<DELConfig>,
  callbacks?: ExecutionCallbacks
): Promise<ExecutionResult> {
  const executor = createDELExecutor(config);
  return executor.execute(rawOutput, callbacks);
}
