import { Task, ChatMessage } from './types.js';
import { getProviderManager } from './provider-manager.js';
import { getToolRegistry } from './tools/registry.js';
import { getLogger } from './logger.js';

export interface AgentRunnerOptions {
  maxIterations?: number;
  timeout?: number;
  enableFallbackParser?: boolean;
}

interface ParsedFile {
  filePath: string;
  content: string;
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
            const parsedFiles = this.parseContentForFiles(response.content);
            if (parsedFiles.length > 0) {
              logger.info(`Fallback parser found ${parsedFiles.length} file(s) to write`);
              for (const file of parsedFiles) {
                try {
                  const writeTool = toolRegistry.get('workspace_write');
                  if (writeTool) {
                    const toolArgs = { projectId, filePath: file.filePath, content: file.content };
                    await writeTool.execute(toolArgs);
                    result.artifacts.push(file.filePath);
                    result.toolCalls++;
                    logger.success(`Fallback wrote: ${file.filePath}`);
                  }
                } catch (writeError) {
                  const errorMsg = writeError instanceof Error ? writeError.message : String(writeError);
                  logger.error(`Fallback write failed for ${file.filePath}: ${errorMsg}`);
                }
              }
              if (result.artifacts.length > 0) {
                result.success = true;
                logger.success(`Fallback parser created ${result.artifacts.length} artifact(s)`);
              }
            } else {
              result.success = false;
              result.error = 'Agent completed without creating any artifacts and fallback parser found no files';
              logger.warn('Agent did not create any files');
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
    return `You are EamilOS, an expert coding agent that produces working code.

CRITICAL RULES:
1. ALWAYS put code inside triple backtick code blocks with the language specified (e.g., \`\`\`python)
2. State the FILENAME before or after the code block (e.g., "Here is hello.py:")
3. Every file you create MUST be complete and runnable
4. After creating code, output it in a code block

Example format:
Here is hello.py:
\`\`\`python
print("Hello World")
\`\`\`

The user wants you to create files. Output your code in properly formatted code blocks with filenames.`;
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

  private parseContentForFiles(content: string): ParsedFile[] {
    const files: ParsedFile[] = [];
    
    const codeBlockRegex = /```(?:(\w+))?\s*\n?([\s\S]*?)```/g;
    let match;
    
    while ((match = codeBlockRegex.exec(content)) !== null) {
      const language = match[1] || '';
      const code = match[2].trim();
      
      if (code && this.looksLikeCode(code)) {
        const filePath = this.extractFilePathFromContext(content, match.index, language);
        if (filePath && !files.some(f => f.filePath === filePath)) {
          files.push({ filePath, content: code });
        }
      }
    }
    
    if (files.length === 0) {
      const directCodeBlocks = content.split(/```/);
      for (let i = 1; i < directCodeBlocks.length; i += 2) {
        const code = directCodeBlocks[i].replace(/^\w+\n?/, '').trim();
        if (code && this.looksLikeCode(code)) {
          const filePath = this.inferFilePath(content, '');
          if (filePath && !files.some(f => f.filePath === filePath)) {
            files.push({ filePath, content: code });
          }
        }
      }
    }
    
    return files;
  }

  private extractFilePathFromContext(content: string, blockIndex: number, language: string): string | null {
    const contextBefore = content.substring(Math.max(0, blockIndex - 200), blockIndex).toLowerCase();
    
    const filePathPatterns = [
      /['"`]?([\w./-]+\.(?:py|js|ts|tsx|jsx|go|rs|java|cpp|c|h|sh|yaml|json|md|txt))['"`]?/gi,
      /(?:file|create|write|save|into)\s+['"`]?([\w./-]+\.(?:py|js|ts|tsx|jsx|go|rs|java|cpp|c|h|sh|yaml|json|md|txt))/gi,
      /(?:named?|called?)\s+['"`]?([\w./-]+)['"`]?/gi,
    ];
    
    for (const pattern of filePathPatterns) {
      const matches = [...contextBefore.matchAll(pattern)];
      if (matches.length > 0) {
        const lastMatch = matches[matches.length - 1];
        const filePath = lastMatch[1];
        if (filePath && !filePath.includes('print') && !filePath.includes('hello')) {
          return filePath;
        }
      }
    }
    
    const taskMatch = content.match(/create\s+(?:a\s+)?(?:python|javascript|typescript|go|rust|java)?\s*(?:file\s+)?([\w./-]+\.\w+)/i);
    if (taskMatch) {
      return taskMatch[1];
    }
    
    return this.inferFilePath(content, language);
  }

  private inferFilePath(content: string, language: string): string {
    const taskMatch = content.match(/create\s+(?:a\s+)?([\w./-]+\.\w+)/i);
    if (taskMatch) {
      return taskMatch[1];
    }
    
    const langMap: Record<string, string[]> = {
      python: ['hello.py', 'main.py', 'script.py', 'app.py'],
      javascript: ['hello.js', 'main.js', 'index.js', 'app.js'],
      typescript: ['hello.ts', 'main.ts', 'index.ts', 'app.ts'],
      jsx: ['App.jsx', 'index.jsx', 'Component.jsx'],
      tsx: ['App.tsx', 'index.tsx', 'Component.tsx'],
      go: ['hello.go', 'main.go'],
      rust: ['hello.rs', 'main.rs', 'lib.rs'],
      java: ['Hello.java', 'Main.java'],
    };
    
    if (language && langMap[language]) {
      return langMap[language][0];
    }
    
    const contentLower = content.toLowerCase();
    if (contentLower.includes('python') || contentLower.includes('def ') || contentLower.includes('import ')) {
      return 'hello.py';
    }
    if (contentLower.includes('javascript') || contentLower.includes('console.log')) {
      return 'hello.js';
    }
    if (contentLower.includes('typescript')) {
      return 'hello.ts';
    }
    
    return 'output.txt';
  }

  private looksLikeCode(text: string): boolean {
    const codeIndicators = [
      /\bfunction\b/,
      /\bdef\b/,
      /\bclass\b/,
      /\bconst\b/,
      /\blet\b/,
      /\bvar\b/,
      /\bimport\b/,
      /\bexport\b/,
      /\bprint\(/,
      /\bconsole\.log\(/,
      /\bSystem\.out\.print/,
      /\bfmt\.Print/,
      /\bprint!\(/,
      /\bpub\s+fn\b/,
      /\breturn\b/,
      /\basync\b/,
      /\bawait\b/,
      /\{[\s\S]*\}/,
      /def\s+\w+\s*\(/,
      /func\s+\w+\s*\(/,
    ];
    
    const matchCount = codeIndicators.filter(indicator => indicator.test(text)).length;
    return matchCount >= 1 && text.length > 10;
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
