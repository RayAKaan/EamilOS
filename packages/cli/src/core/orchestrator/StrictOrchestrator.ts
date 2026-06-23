import { ChatMessage } from '../types.js';
import { getProviderManager } from '../provider-manager.js';
import { parseResponse, ParsedFile, ParseResult } from '../parsers/ResponseParser.js';
import { validate } from '../validation/ArtifactValidator.js';
import { STRICT_SYSTEM_PROMPT } from '../prompts/system.js';
import { getToolRegistry } from '../tools/registry.js';
import { getLogger } from '../logger.js';
import { getModelRouter, ModelRouter } from '../model-router/index.js';
import { getConfig } from '../config.js';
import { FeatureManager } from '../features/FeatureManager.js';
import { FeatureContext } from '../features/types.js';
import { TaskClassifier, TaskCategory } from '../model-router/TaskClassifier.js';

export interface OrchestratorConfig {
  maxRetries?: number;
  timeout?: number;
  useModelRouter?: boolean;
  preferredModel?: string;
  preferredProvider?: string;
  featureManager?: FeatureManager;
}

export interface OrchestratorResult {
  success: boolean;
  artifacts: string[];
  attempts: number;
  failureReasons: string[];
  files?: ParsedFile[];
  featureData?: Record<string, unknown>;
}

const DEFAULT_MAX_RETRIES = 3;

interface StrictOrchestratorConfig {
  maxRetries: number;
  timeout: number;
  useModelRouter: boolean;
  preferredModel?: string;
  preferredProvider?: string;
}

export class StrictOrchestrator {
  private config: StrictOrchestratorConfig;
  private modelRouter: ModelRouter | null = null;
  private useRouter: boolean;
  private featureManager: FeatureManager | null = null;
  private classifier: TaskClassifier;

  constructor(config: OrchestratorConfig = {}) {
    this.config = {
      maxRetries: config.maxRetries ?? DEFAULT_MAX_RETRIES,
      timeout: config.timeout ?? 120000,
      useModelRouter: config.useModelRouter ?? false,
      preferredModel: config.preferredModel,
      preferredProvider: config.preferredProvider,
    };
    this.useRouter = this.config.useModelRouter;
    this.featureManager = config.featureManager || null;
    this.classifier = new TaskClassifier();

    if (this.useRouter) {
      this.modelRouter = getModelRouter();
    }
  }

  async execute(task: string, projectId: string): Promise<OrchestratorResult> {
    const logger = getLogger();
    const failureReasons: string[] = [];
    const toolRegistry = getToolRegistry();
    const writeTool = toolRegistry.get('workspace_write');

    let currentModelId = this.config.preferredModel;
    let currentProvider = this.config.preferredProvider;
    const startTime = Date.now();

    const ctx = this.createFeatureContext(task);

    if (this.featureManager) {
      await this.featureManager.runHook('beforeClassification', ctx);
    }

    const classification = this.classifier.classify(task);
    ctx.taskCategory = classification.primaryCategory;
    ctx.taskComplexity = classification.complexity;
    ctx.estimatedTokens = classification.estimatedTokens;

    if (this.featureManager) {
      await this.featureManager.runHook('afterClassification', ctx);
    }

    if (this.useRouter && this.modelRouter) {
      try {
        const availableModels = await this.getAvailableModels();
        ctx.availableModels = availableModels;
        const modelSelection = this.modelRouter.selectModel(task, availableModels);
        currentModelId = modelSelection.modelId;
        currentProvider = modelSelection.provider;

        ctx.selectedModel = {
          modelId: modelSelection.modelId,
          provider: modelSelection.provider,
          score: modelSelection.score.totalScore
        };
        ctx.alternateModels = modelSelection.alternates.map(a => ({
          modelId: a.modelId,
          provider: a.provider,
          score: a.totalScore
        }));

        logger.debug(`Router selected model: ${currentModelId}`, {
          metadata: {
            method: modelSelection.selectionMethod,
            score: modelSelection.score.totalScore
          }
        });
      } catch (e) {
        logger.warn('Model router failed, using fallback', {
          metadata: {
            error: e instanceof Error ? e.message : String(e)
          }
        });
      }
    }

    if (this.featureManager) {
      await this.featureManager.runHook('afterModelSelection', ctx);
    }

    if (ctx.signals.skipExecution && ctx.signals.overrideResult) {
      logger.info('Feature handled execution, using override result');
      if (this.featureManager) {
        await this.featureManager.runHook('afterExecution', ctx);
      }
      return this.buildResultFromParseResult(ctx.signals.overrideResult, ctx);
    }

    currentModelId = ctx.selectedModel.modelId || currentModelId;
    currentProvider = ctx.selectedModel.provider || currentProvider;

    for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
      ctx.currentAttempt = attempt;
      logger.info(`Orchestrator attempt ${attempt}/${this.config.maxRetries}`);

      const escalationPrompt = attempt > 1
        ? this.buildEscalationPrompt(task, failureReasons, attempt)
        : task;

      ctx.systemPrompt = STRICT_SYSTEM_PROMPT;
      ctx.userPrompt = escalationPrompt;
      ctx.promptMode = attempt >= 3 ? 'nuclear' : attempt >= 2 ? 'strict' : 'initial';

      if (this.featureManager) {
        await this.featureManager.runHook('beforeExecution', ctx);
      }

      if (ctx.signals.abortExecution) {
        logger.error(`Execution aborted by feature: ${ctx.signals.abortReason}`);
        if (this.featureManager) {
          await this.featureManager.runHook('afterExecution', ctx);
        }
        return {
          success: false,
          artifacts: [],
          attempts: attempt,
          failureReasons: [ctx.signals.abortReason || 'ABORTED_BY_FEATURE'],
          featureData: this.mapToObject(ctx.featureData)
        };
      }

      const systemPrompt = ctx.systemPrompt;
      const userPrompt = ctx.userPrompt;

      const messages: ChatMessage[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ];

      try {
        const attemptStartTime = Date.now();
        const response = await Promise.race([
          getProviderManager().chat(messages, undefined, currentProvider),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('LLM call timed out')), this.config.timeout)
          ),
        ]);

        const rawContent = response.content || '';
        logger.debug(`Raw LLM response (${rawContent.length} chars)`);

        const parseResult = parseResponse(rawContent);

        ctx.executionResult = {
          success: parseResult.success && parseResult.files.length > 0,
          files: parseResult.files,
          retriesUsed: attempt,
          latencyMs: Date.now() - attemptStartTime,
          tokensUsed: 0,
          parseSucceeded: parseResult.success,
          validationSucceeded: parseResult.files.length > 0,
          failureReason: parseResult.failureReason
        };

        if (this.featureManager) {
          await this.featureManager.runHook('afterAttempt', ctx);
        }

        if (ctx.signals.forceRetry) {
          ctx.signals.forceRetry = false;
          continue;
        }

        if (!parseResult.success) {
          const reason = parseResult.failureReason || 'PARSE_FAILED';
          failureReasons.push(`Attempt ${attempt}: ${reason}`);
          logger.warn(`Parse failed: ${reason}`);
          continue;
        }

        const validationResult = validate(parseResult.files);

        if (!validationResult.valid) {
          const reason = validationResult.errors.map(e => e.reason).join('; ');
          failureReasons.push(`Attempt ${attempt}: VALIDATION_FAILED - ${reason}`);
          logger.warn(`Validation failed: ${reason}`);
          if (validationResult.errors.length > 0) {
            logger.debug(`Validation errors: ${JSON.stringify(validationResult.errors)}`);
          }
          continue;
        }

        const artifacts: string[] = [];

        for (const file of validationResult.validFiles) {
          try {
            if (writeTool) {
              await writeTool.execute({
                projectId,
                filePath: file.path,
                content: file.content,
              });
              artifacts.push(file.path);
              logger.success(`Wrote artifact: ${file.path}`);
            }
          } catch (writeError) {
            const errMsg = writeError instanceof Error ? writeError.message : String(writeError);
            failureReasons.push(`Attempt ${attempt}: WRITE_FAILED - ${file.path}: ${errMsg}`);
            logger.error(`Write failed for ${file.path}: ${errMsg}`);
          }
        }

        if (artifacts.length > 0) {
          logger.success(`Task completed with ${artifacts.length} artifact(s)`);

          if (this.useRouter && this.modelRouter && currentModelId && currentProvider) {
            this.modelRouter.recordResult(
              currentModelId,
              currentProvider,
              task,
              {
                success: true,
                retriesUsed: attempt - 1,
                latencyMs: Date.now() - startTime,
                tokensUsed: 0,
                costUsd: 0,
                parseSucceeded: true,
                validationSucceeded: true
              }
            );
          }

          if (this.featureManager) {
            ctx.executionResult = {
              success: true,
              files: validationResult.validFiles,
              retriesUsed: attempt - 1,
              latencyMs: Date.now() - startTime,
              tokensUsed: 0,
              parseSucceeded: true,
              validationSucceeded: true
            };
            await this.featureManager.runHook('afterExecution', ctx);
          }

          return {
            success: true,
            artifacts,
            attempts: attempt,
            failureReasons,
            files: validationResult.validFiles,
            featureData: this.mapToObject(ctx.featureData)
          };
        }

        failureReasons.push(`Attempt ${attempt}: NO_ARTIFACTS_WRITTEN`);
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        failureReasons.push(`Attempt ${attempt}: ${errMsg}`);
        logger.error(`Orchestrator error: ${errMsg}`);

        if (this.featureManager) {
          await this.featureManager.runHook('onError', ctx, error as Error);
        }

        if (ctx.signals.abortExecution) {
          if (this.featureManager) {
            await this.featureManager.runHook('afterExecution', ctx);
          }
          return {
            success: false,
            artifacts: [],
            attempts: attempt,
            failureReasons: [ctx.signals.abortReason || 'ABORTED_AFTER_ERROR'],
            featureData: this.mapToObject(ctx.featureData)
          };
        }
      }
    }

    logger.error(`All ${this.config.maxRetries} attempts exhausted`);

    if (this.useRouter && this.modelRouter && currentModelId && currentProvider) {
      this.modelRouter.recordResult(
        currentModelId,
        currentProvider,
        task,
        {
          success: false,
          retriesUsed: this.config.maxRetries,
          latencyMs: Date.now() - startTime,
          tokensUsed: 0,
          costUsd: 0,
          parseSucceeded: false,
          validationSucceeded: false,
          failureReason: failureReasons[failureReasons.length - 1]
        }
      );
    }

    if (this.featureManager) {
      ctx.executionResult = {
        success: false,
        files: [],
        retriesUsed: this.config.maxRetries,
        latencyMs: Date.now() - startTime,
        tokensUsed: 0,
        parseSucceeded: false,
        validationSucceeded: false,
        failureReason: failureReasons[failureReasons.length - 1]
      };
      await this.featureManager.runHook('afterExecution', ctx);
    }

    return {
      success: false,
      artifacts: [],
      attempts: this.config.maxRetries,
      failureReasons,
      featureData: this.mapToObject(ctx.featureData)
    };
  }

  private createFeatureContext(instruction: string): FeatureContext {
    return {
      instruction,
      taskCategory: 'simple' as TaskCategory,
      taskComplexity: 'moderate',
      estimatedTokens: 0,
      selectedModel: { modelId: '', provider: '', score: 0 },
      alternateModels: [],
      availableModels: [],
      systemPrompt: '',
      userPrompt: '',
      promptMode: 'initial',
      currentAttempt: 0,
      maxRetries: this.config.maxRetries,
      totalTokensUsed: 0,
      totalLatencyMs: 0,
      featureData: new Map(),
      signals: {
        skipExecution: false,
        overrideResult: null,
        forceRetry: false,
        abortExecution: false,
      },
      executionId: crypto.randomUUID(),
      startTime: Date.now(),
      config: getConfig() as unknown as Record<string, unknown>
    };
  }

  private buildResultFromParseResult(parseResult: ParseResult, ctx: FeatureContext): OrchestratorResult {
    const artifacts = parseResult.files.map(f => f.path);
    return {
      success: parseResult.success,
      artifacts,
      attempts: 1,
      failureReasons: parseResult.success ? [] : [parseResult.failureReason || 'PARSE_FAILED'],
      files: parseResult.files,
      featureData: this.mapToObject(ctx.featureData)
    };
  }

  private mapToObject(map: Map<string, unknown>): Record<string, unknown> {
    const obj: Record<string, unknown> = {};
    for (const [key, value] of map.entries()) {
      obj[key] = value;
    }
    return obj;
  }

  private async getAvailableModels(): Promise<Array<{ modelId: string; provider: string }>> {
    const models: Array<{ modelId: string; provider: string }> = [];
    const config = getConfig();

    for (const providerConfig of config.providers) {
      for (const modelConfig of providerConfig.models) {
        models.push({ modelId: modelConfig.id, provider: providerConfig.id });
      }
    }

    if (models.length === 0) {
      models.push({ modelId: 'phi3:mini', provider: 'ollama' });
    }

    return models;
  }

  private buildEscalationPrompt(originalTask: string, reasons: string[], attempt: number): string {
    const lastReason = reasons.length > 0 ? reasons[reasons.length - 1] : 'UNKNOWN';
    
    let escalation = `\n\n========================================\nYOUR PREVIOUS RESPONSE WAS REJECTED.\nReason: ${lastReason}\n========================================\n\nYou MUST respond with ONLY valid JSON in this exact format:\n\n{\n  "summary": "brief description of what you created",\n  "files": [\n    {\n      "path": "filename.ext",\n      "content": "complete file content",\n      "language": "programming_language"\n    }\n  ]\n}\n\n`;

    if (attempt >= 3) {
      escalation += `CRITICAL: Output ONLY a JSON object. Nothing else. Any non-JSON text will cause immediate rejection.\n\n`;
    }

    escalation += `Task: ${originalTask}`;

    return escalation;
  }
}

let globalOrchestrator: StrictOrchestrator | null = null;

export function initOrchestrator(config?: OrchestratorConfig): StrictOrchestrator {
  globalOrchestrator = new StrictOrchestrator(config);
  return globalOrchestrator;
}

export function getOrchestrator(): StrictOrchestrator {
  if (!globalOrchestrator) {
    globalOrchestrator = new StrictOrchestrator();
  }
  return globalOrchestrator;
}
