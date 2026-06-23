import { Task, ChatMessage } from './types.js';
import { getProviderManager } from './provider-manager.js';
import { getToolRegistry } from './tools/registry.js';
import { getLogger } from './logger.js';
import { getResponseParser } from './parser/response-parser.js';
import { OUTPUT_FORMAT_INSTRUCTIONS } from './agents/output-format-prompt.js';

export interface AgentRunnerOptions {
  maxIterations?: number;
  timeout?: number;
  enableFallbackParser?: boolean;
}

export interface AgentExecutionResult {
  success: boolean;
  taskId: string;
  artifacts: string[];
  output: string;
  toolCalls: number;
  error?: string;
}

export class AgentRunner {
  private options: AgentRunnerOptions;

  constructor(options: AgentRunnerOptions = {}) {
    this.options = {
      maxIterations: options.maxIterations ?? 20,
      timeout: options.timeout ?? 120000,
      enableFallbackParser: options.enableFallbackParser ?? true,
      ...options,
    };
  }

  async run(
    task: Task,
    projectId: string,
    context: string,
    systemPrompt?: string
  ): Promise<AgentExecutionResult> {
    const logger = getLogger();
    const result: AgentExecutionResult = {
      success: false,
      taskId: task.id,
      artifacts: [],
      output: '',
      toolCalls: 0,
    };

    const messages: ChatMessage[] = [];

    const systemContent = systemPrompt || this.getDefaultSystemPrompt();
    messages.push({ role: 'system', content: systemContent });

    const taskDescription = `Project: ${projectId}
Task: ${task.title}
Description: ${task.description}
Type: ${task.type}

Context:
${context}`;

    messages.push({ role: 'user', content: taskDescription });

    const toolRegistry = getToolRegistry();
    const tools = toolRegistry.list().filter((t) => 
      ['workspace_write', 'workspace_read', 'workspace_list'].includes(t.name)
    );

    const toolDefinitions = tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: this.zodToJsonSchema(tool.inputSchema),
    }));

    const supportsTools = getProviderManager().supportsTools();
    logger.info(`Starting agent execution for task: ${task.title}`);
    logger.debug(`Available tools: ${tools.map((t) => t.name).join(', ')} | Tools enabled: ${supportsTools}`);

    try {
      let iterations = 0;

      while (iterations < (this.options.maxIterations ?? 20)) {
        iterations++;

        logger.debug(`Agent iteration ${iterations}/${this.options.maxIterations}`);

        const response = await getProviderManager().chat(
          messages, 
          supportsTools ? toolDefinitions : undefined
        );

        if (response.toolCalls && response.toolCalls.length > 0) {
          for (const toolCall of response.toolCalls) {
            result.toolCalls++;
            logger.info(`Tool call: ${toolCall.name}(${JSON.stringify(toolCall.arguments)})`);

            const tool = toolRegistry.get(toolCall.name);
            if (!tool) {
              messages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: `Error: Unknown tool ${toolCall.name}`,
              });
              continue;
            }

            try {
              const toolArgs = { projectId, ...toolCall.arguments } as Record<string, unknown>;
              const toolResult = await Promise.race([
                tool.execute(toolArgs),
                new Promise((_, reject) =>
                  setTimeout(() => reject(new Error(`Tool ${tool.name} timed out`)), this.options.timeout)
                )
              ]);

              const resultJson = JSON.stringify(toolResult);
              logger.debug(`Tool ${tool.name} result: ${resultJson.substring(0, 200)}...`);

              messages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: resultJson,
              });

              if (tool.name === 'workspace_write') {
                const args = toolArgs as { filePath: string };
                result.artifacts.push(args.filePath);
              }
            } catch (toolError) {
              const errorMsg = toolError instanceof Error ? toolError.message : String(toolError);
              logger.error(`Tool ${tool.name} failed: ${errorMsg}`);
              messages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: `Error: ${errorMsg}`,
              });
            }
          }
        } else if (response.content) {
          messages.push({ role: 'assistant', content: response.content });
          result.output = response.content;
          
          if (result.artifacts.length > 0) {
            result.success = true;
            logger.success(`Task completed with ${result.artifacts.length} artifact(s)`);
          } else if (this.options.enableFallbackParser) {
            const parser = getResponseParser();
            const parseResult = parser.parse(response.content);
            
            if (parseResult.success && parseResult.files.length > 0) {
              logger.info(`Parser (${parseResult.parseMethod}) found ${parseResult.files.length} file(s) to write`);
              for (const file of parseResult.files) {
                try {
                  const writeTool = toolRegistry.get('workspace_write');
                  if (writeTool) {
                    const toolArgs = { projectId, filePath: file.filePath, content: file.content };
                    await writeTool.execute(toolArgs);
                    result.artifacts.push(file.filePath);
                    result.toolCalls++;
                    logger.success(`Parser wrote: ${file.filePath}`);
                  }
                } catch (writeError) {
                  const errorMsg = writeError instanceof Error ? writeError.message : String(writeError);
                  logger.error(`Write failed for ${file.filePath}: ${errorMsg}`);
                }
              }
              if (result.artifacts.length > 0) {
                result.success = true;
                logger.success(`Parser created ${result.artifacts.length} artifact(s)`);
              }
            } else {
              result.success = false;
              result.error = parseResult.error || 'No files found in response';
              logger.warn(`Parser failed: ${result.error}`);
            }
          } else {
            result.success = false;
            result.error = 'Agent completed without creating any artifacts';
            logger.warn('Agent did not create any files');
          }
          break;
        } else {
          logger.warn('Empty response from LLM');
          messages.push({ role: 'assistant', content: '(No content)' });
        }

        if (iterations >= (this.options.maxIterations ?? 20)) {
          result.error = 'Max iterations reached';
          logger.warn('Max iterations reached');
        }
      }

      if (!result.success && !result.error) {
        result.error = 'Agent did not produce artifacts';
      }

    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
      logger.error(`Agent execution failed: ${result.error}`);
    }

    return result;
  }

  private getDefaultSystemPrompt(): string {
    return `${OUTPUT_FORMAT_INSTRUCTIONS}

The user wants you to create files. Use workspace_write tool when available, or output valid JSON with files array.`;
  }

  private zodToJsonSchema(schema: unknown): Record<string, unknown> {
    if (schema && typeof schema === 'object' && 'shape' in (schema as object)) {
      const zodSchema = schema as { shape: Record<string, unknown> };
      const shape = zodSchema.shape;
      const properties: Record<string, unknown> = {};
      const required: string[] = [];

      for (const [key, value] of Object.entries(shape)) {
        const typeName = this.getZodTypeName(value);
        properties[key] = { type: typeName };
        required.push(key);
      }

      return {
        type: 'object',
        properties,
        required,
      };
    }

    return {
      type: 'object',
      properties: {},
      required: [],
    };
  }

  private getZodTypeName(zodType: unknown): string {
    const typeStr = String(zodType);
    if (typeStr.includes('string')) return 'string';
    if (typeStr.includes('number')) return 'number';
    if (typeStr.includes('boolean')) return 'boolean';
    if (typeStr.includes('array')) return 'array';
    if (typeStr.includes('object')) return 'object';
    return 'string';
  }

}

let globalAgentRunner: AgentRunner | null = null;

export function initAgentRunner(options?: AgentRunnerOptions): AgentRunner {
  globalAgentRunner = new AgentRunner(options);
  return globalAgentRunner;
}

export function getAgentRunner(): AgentRunner {
  if (!globalAgentRunner) {
    return initAgentRunner();
  }
  return globalAgentRunner;
}
