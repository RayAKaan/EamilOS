// PHASE 2: Full implementation - progressive pressure retry strategy
import { Task } from './types.js';

interface _AgentDefinition {
  id: string;
}

export type PressureLevel = 'normal' | 'elevated' | 'critical';

export interface RetryContext {
  originalContext: string;
  retryCount: number;
  maxRetries: number;
  lastError?: string;
  missingArtifacts?: string[];
  emptyArtifacts?: string[];
}

export interface PressurePrompt {
  level: PressureLevel;
  message: string;
  instructions: string;
}

export class RetryStrategy {
  private maxRetries: number;

  constructor(maxRetries: number = 3) {
    this.maxRetries = maxRetries;
  }

  getPressureLevel(retryCount: number): PressureLevel {
    if (retryCount <= 0) return 'normal';
    if (retryCount === 1) return 'elevated';
    return 'critical';
  }

  buildRetryContext(_task: Task, _agent: _AgentDefinition, context: RetryContext): string {
    const pressure = this.getPressureLevel(context.retryCount);
    const prompt = this.getPressurePrompt(pressure, context);

    return `${context.originalContext}

${prompt.message}

${prompt.instructions}`;
  }

  private getPressurePrompt(level: PressureLevel, context: RetryContext): PressurePrompt {
    switch (level) {
      case 'normal':
        return {
          level: 'normal',
          message: '## RETRY ATTEMPT',
          instructions: `This is retry attempt #${context.retryCount + 1}.
Please review your previous work and try again.`,
        };

      case 'elevated':
        return {
          level: 'elevated',
          message: `## ⚠️ RETRY ATTEMPT ${context.retryCount + 1}/${this.maxRetries}`,
          instructions: `Your previous attempt failed${context.lastError ? `: ${context.lastError}` : ''}.
${this.getArtifactInstructions(context)}

You MUST produce working artifacts. This is not optional.`,
        };

      case 'critical':
        return {
          level: 'critical',
          message: `## 🚨 FINAL ATTEMPT ${context.retryCount + 1}/${this.maxRetries}`,
          instructions: `This is your LAST chance. If you fail again, the task will be marked as failed.

${this.getArtifactInstructions(context)}

CRITICAL REQUIREMENTS:
1. Use workspace_write to create ALL artifacts
2. Files must contain COMPLETE, WORKING code
3. Do NOT include placeholders, TODOs, or pseudo-code
4. Verify file content before considering the task complete`,
        };
    }
  }

  private getArtifactInstructions(context: RetryContext): string {
    const instructions: string[] = [];

    if (context.missingArtifacts && context.missingArtifacts.length > 0) {
      instructions.push(`MISSING ARTIFACTS: You must create the following files using workspace_write:
${context.missingArtifacts.map((a) => `  - ${a}`).join('\n')}`);
    }

    if (context.emptyArtifacts && context.emptyArtifacts.length > 0) {
      instructions.push(`EMPTY ARTIFACTS: The following files are empty or too short:
${context.emptyArtifacts.map((a) => `  - ${a}`).join('\n')}
These files must contain COMPLETE content.`);
    }

    if (instructions.length === 0) {
      instructions.push(`You must use workspace_write to create ALL artifacts.
Do NOT output code in your response text. Write it to files using the tools provided.`);
    }

    return instructions.join('\n\n');
  }

  shouldRetry(retryCount: number, error?: string, previousError?: string): boolean {
    if (retryCount >= this.maxRetries) {
      return false;
    }

    if (error && previousError && error === previousError) {
      return false;
    }

    return true;
  }

  getMaxRetries(): number {
    return this.maxRetries;
  }

  setMaxRetries(max: number): void {
    this.maxRetries = max;
  }
}

let globalRetryStrategy: RetryStrategy | null = null;

export function initRetryStrategy(maxRetries?: number): RetryStrategy {
  globalRetryStrategy = new RetryStrategy(maxRetries);
  return globalRetryStrategy;
}

export function getRetryStrategy(): RetryStrategy {
  if (!globalRetryStrategy) {
    return initRetryStrategy();
  }
  return globalRetryStrategy;
}
