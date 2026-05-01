import { Template } from './types.js';
import { getTemplateRegistry } from './registry.js';
import { getProviderManager } from '../providers/ProviderManager.js';
import { getToolRegistry } from '../tools/registry.js';
import { getLogger } from '../logger.js';
import { getCostTracker } from '../control/CostTracker.js';
import { ChatMessage } from '../types.js';
import * as fs from 'fs';
import * as path from 'path';

export interface TemplateExecutionResult {
  templateId: string;
  success: boolean;
  filesGenerated: number;
  filesWritten: number;
  commands: string[];
  totalCost: number;
  durationMs: number;
  errors: string[];
}

export class TemplateEngine {
  async execute(
    templateId: string,
    variables: Record<string, string | number | boolean>,
    outputDir: string
  ): Promise<TemplateExecutionResult> {
    const logger = getLogger();
    const startTime = Date.now();
    const result: TemplateExecutionResult = {
      templateId,
      success: false,
      filesGenerated: 0,
      filesWritten: 0,
      commands: [],
      totalCost: 0,
      durationMs: 0,
      errors: [],
    };

    const registry = getTemplateRegistry();
    const template = registry.getTemplate(templateId);
    if (!template) {
      throw new Error(`Template not found: ${templateId}`);
    }

    logger.info(`Executing template: ${template.name} (${templateId})`);

    const resolvedFiles = this.resolveTemplate(template, variables);
    result.filesGenerated = resolvedFiles.length;

    const writeTool = getToolRegistry().get('workspace_write');

    for (const { filePath, content } of resolvedFiles) {
      const fullPath = path.join(outputDir, filePath);
      try {
        const dir = path.dirname(fullPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }

        if (writeTool) {
          await writeTool.execute({ projectId: templateId, filePath: fullPath, content });
        } else {
          fs.writeFileSync(fullPath, content, 'utf-8');
        }

        result.filesWritten++;
        logger.success(`Generated: ${filePath}`);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        result.errors.push(`Failed to write ${filePath}: ${msg}`);
        logger.error(`Failed to write ${filePath}: ${msg}`);
      }
    }

    const costTracker = getCostTracker();
    if (costTracker) {
      result.totalCost = costTracker.getCurrentCost();
    }

    result.commands = template.postGenerate.commands;
    result.durationMs = Date.now() - startTime;
    result.success = result.filesWritten > 0 && result.errors.length === 0;

    return result;
  }

  private resolveTemplate(
    template: Template,
    variables: Record<string, string | number | boolean>
  ): Array<{ filePath: string; content: string }> {
    return template.files.map(file => {
      let content = file.template;
      const resolvedPath = this.interpolate(file.path, variables);

      for (const [key, value] of Object.entries(variables)) {
        content = content.replaceAll(`{{${key}}}`, String(value));
      }

      for (const variable of template.variables) {
        if (variables[variable.name] === undefined && variable.default !== undefined) {
          content = content.replaceAll(`{{${variable.name}}}`, String(variable.default));
        }
      }

      return { filePath: resolvedPath, content };
    });
  }

  private interpolate(str: string, variables: Record<string, string | number | boolean>): string {
    let result = str;
    for (const [key, value] of Object.entries(variables)) {
      result = result.replaceAll(`{{${key}}}`, String(value));
    }
    return result;
  }

  async runWorkflow(templateId: string, _variables: Record<string, string | number | boolean>): Promise<void> {
    const logger = getLogger();
    const registry = getTemplateRegistry();
    const template = registry.getTemplate(templateId);
    if (!template) throw new Error(`Template not found: ${templateId}`);

    logger.info(`Running workflow: ${template.workflow.name}`);

    for (const step of template.workflow.steps) {
      logger.info(`Workflow step: ${step.phase}`);

      const messages: ChatMessage[] = [
        { role: 'system', content: `You are a ${step.agent === 'auto' ? 'versatile AI assistant' : step.agent}. Follow the instructions precisely.` },
        { role: 'user', content: step.prompt },
      ];

      try {
        const response = await Promise.race([
          getProviderManager().chat(messages),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`Step '${step.phase}' timed out`)), step.timeout ?? 120000)
          ),
        ]);

        logger.debug(`Step '${step.phase}' completed. Response: ${response.content?.length ?? 0} chars`);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.warn(`Step '${step.phase}' failed: ${msg}`);
      }
    }
  }

  getEstimatedCost(templateId: string): { min: number; max: number } | null {
    const registry = getTemplateRegistry();
    const template = registry.getTemplate(templateId);
    if (!template) return null;
    return template.estimatedCost;
  }
}
