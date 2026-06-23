import { EventEmitter } from 'events';
import { OpenCodeAgent } from '../agents/OpenCodeAgent.js';
import { GeminiCliAgent } from '../agents/GeminiCliAgent.js';
import { Graphify } from '../graph/Graphify.js';

function isErrorResponse(content: string): boolean {
  if (!content || content.length > 5000) return false;
  try {
    const parsed = JSON.parse(content);
    if (parsed.error || parsed.errorMessage) return true;
  } catch {}
  const lower = content.toLowerCase();
  return /authentication|auth method|api.key|not configured|command not found|enoent|spawn.*enode/i.test(lower);
}

export type ExecutionStrategy = 'gemini-first' | 'opencode-first' | 'parallel' | 'swarm';
export type TaskType = 'code' | 'research' | 'analyze' | 'refactor' | 'debug' | 'general';

export interface OrchestratorConfig {
  strategy: ExecutionStrategy;
  workingDir: string;
  maxRetries?: number;
  timeoutMs?: number;
  env?: Record<string, string>;
}

export interface ExecutionResult {
  success: boolean;
  taskId: string;
  strategy: ExecutionStrategy;
  primaryResult?: string;
  secondaryResult?: string;
  finalOutput?: string;
  files: { path: string; action: string; content?: string }[];
  graphNodes: string[];
  attempts: number;
  duration: number;
  errors: string[];
  validated?: boolean;
}

export interface TaskAnalysis {
  type: TaskType;
  complexity: 'low' | 'medium' | 'high';
  requiresResearch: boolean;
  requiresCodeGeneration: boolean;
  estimatedAgents: ('opencode' | 'gemini-cli')[];
  suggestedStrategy: ExecutionStrategy;
  reasoning: string;
}

export class DualOrchestrator extends EventEmitter {
  private openCodeAgent: OpenCodeAgent;
  private geminiAgent: GeminiCliAgent;
  private graph: Graphify;
  private config: OrchestratorConfig;

  constructor(config: OrchestratorConfig) {
    super();
    this.config = {
      maxRetries: 3,
      timeoutMs: 180000,
      ...config,
    };

    this.openCodeAgent = new OpenCodeAgent({
      workingDir: config.workingDir,
      env: config.env,
      timeoutMs: config.timeoutMs,
    });

    this.geminiAgent = new GeminiCliAgent({
      workingDir: config.workingDir,
      env: config.env,
      timeoutMs: config.timeoutMs,
    });

    this.graph = new Graphify();

    this.graph.createAgentNode('opencode', 'OpenCode Agent', [
      'code-generation', 'refactoring', 'multi-model', 'file-editing',
    ]);
    this.graph.createAgentNode('gemini-cli', 'Gemini CLI Agent', [
      'research', 'analysis', 'fast-iteration', 'web-search',
    ]);
  }

  async analyzeTask(task: string): Promise<TaskAnalysis> {
    const analysis = await this.geminiAgent.send(
      `Analyze this task and respond with ONLY valid JSON (no markdown, no explanation): {
  "type": "code|research|analyze|refactor|debug|general",
  "complexity": "low|medium|high",
  "requiresResearch": true|false,
  "requiresCodeGeneration": true|false,
  "estimatedAgents": ["opencode"|"gemini-cli", ...],
  "suggestedStrategy": "gemini-first|opencode-first|parallel|swarm",
  "reasoning": "brief explanation"
}

Task: "${task}"`
    );

    const geminiAvailable = !isErrorResponse(analysis.content);

    if (geminiAvailable) {
      try {
        const jsonMatch = analysis.content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]) as TaskAnalysis;
          if (parsed.type && parsed.suggestedStrategy) {
            return parsed;
          }
        }
      } catch {
        // fall through
      }
    }

    const requiresCode = /\b(build|create|implement|write|generate|code|function|class|api|app|file)\b/i.test(task);
    const requiresResearch = /\b(analyze|research|explain|find|search|look up|what is|how does)\b/i.test(task);

    return {
      type: requiresCode ? 'code' : requiresResearch ? 'research' : 'general',
      complexity: task.length > 200 ? 'high' : task.length > 100 ? 'medium' : 'low',
      requiresResearch,
      requiresCodeGeneration: requiresCode,
      estimatedAgents: requiresCode ? ['opencode'] : ['opencode'],
      suggestedStrategy: requiresCode ? 'opencode-first' : 'opencode-first',
      reasoning: geminiAvailable
        ? 'Auto-analyzed based on task keywords'
        : 'Gemini unavailable, delegating to OpenCode',
    };
  }

  async execute(task: string, forceStrategy?: ExecutionStrategy): Promise<ExecutionResult> {
    const startTime = Date.now();
    const taskNode = this.graph.createTask(task);
    const result: ExecutionResult = {
      success: false,
      taskId: taskNode.id,
      strategy: forceStrategy || this.config.strategy,
      files: [],
      graphNodes: [taskNode.id],
      attempts: 0,
      duration: 0,
      errors: [],
    };

    this.emit('task:started', { task, taskId: taskNode.id });

    const analysis = await this.analyzeTask(task);
    result.strategy = forceStrategy || analysis.suggestedStrategy;

    this.graph.updateNode(taskNode.id, {
      properties: { ...taskNode.properties, analysis },
    });

    const maxRetries = this.config.maxRetries || 3;

    while (result.attempts < maxRetries && !result.success) {
      result.attempts++;

      try {
        let execResult;

        switch (result.strategy) {
          case 'gemini-first':
            execResult = await this.executeGeminiFirst(task, analysis);
            break;
          case 'opencode-first':
            execResult = await this.executeOpenCodeFirst(task, analysis);
            break;
          case 'parallel':
            execResult = await this.executeParallel(task, analysis);
            break;
          case 'swarm':
            execResult = await this.executeSwarm(task, analysis);
            break;
          default:
            execResult = await this.executeGeminiFirst(task, analysis);
        }

        const validationResult = await this.validateOutput(execResult, analysis.type);

        if (validationResult.valid) {
          result.success = true;
          result.primaryResult = execResult.primary;
          result.secondaryResult = execResult.secondary;
          result.finalOutput = validationResult.output;
          result.files = validationResult.files;
          result.validated = true;

          this.graph.completeTask(taskNode.id, result.finalOutput || '');
          this.emit('task:completed', { taskId: taskNode.id, attempts: result.attempts });
        } else {
          this.graph.recordError(
            `Validation failed: ${validationResult.errors.join(', ')}`,
            'eamilos',
            { attempt: result.attempts, taskId: taskNode.id }
          );
          task = `${task}\n\nIMPORTANT: Previous attempt had these issues: ${validationResult.errors.join('; ')}. Please correct them.`;
          result.errors.push(...validationResult.errors);
        }
      } catch (err) {
        result.errors.push((err as Error).message);
        this.graph.recordError((err as Error).message, 'orchestrator', { attempt: result.attempts });
      }
    }

    result.duration = Date.now() - startTime;

    if (!result.success && result.errors.length > 0) {
      this.graph.updateNode(taskNode.id, {
        properties: { ...taskNode.properties, status: 'failed', errors: result.errors },
      });
      this.emit('task:failed', { taskId: taskNode.id, errors: result.errors });
    }

    return result;
  }

  private async executeGeminiFirst(
    task: string,
    analysis: TaskAnalysis
  ): Promise<{ primary: string; secondary: string; files: { path: string; action: string; content?: string }[] }> {
    const researchPrompt = analysis.requiresResearch
      ? `Research and plan: ${task}\n\nProvide a clear plan with specific steps, any files that need to be created/modified, and key considerations.`
      : task;

    const research = await this.geminiAgent.send(researchPrompt);

    if (isErrorResponse(research.content)) {
      this.graph.recordError('Gemini unavailable, falling back to OpenCode', 'eamilos', { task });
      return this.executeOpenCodeFirst(task, analysis);
    }

    this.graph.recordAgentAction('gemini-cli', 'research', research.content, { taskId: this.graph.search({ labelContains: task }).nodes[0]?.id });

    this.graph.recordConcept(`Research: ${task.slice(0, 50)}`, 'gemini-cli', research.content.slice(0, 500));

    let contextStr = this.graph.buildContextString('opencode');
    const implementationPrompt = analysis.requiresCodeGeneration
      ? `${research.content}\n\n## Previous Research (from Knowledge Graph)\n${contextStr}\n\nNow implement the solution. Create actual working files with real code. Return JSON: {"files": [{"path": "filename.ext", "content": "..."}]}`
      : research.content;

    const implementation = await this.openCodeAgent.send(implementationPrompt);
    this.graph.recordAgentAction('opencode', 'implementation', implementation.content);

    const files = this.extractFiles(implementation.content, 'opencode');
    for (const file of files) {
      const content = file.content || this.extractContentFromResponse(implementation.content, file.path);
      this.graph.trackFile(file.path, content, 'opencode', 'created');
      this.graph.recordValidation(file.path, 'eamilos', 'passed', 'File created by OpenCode');
    }

    return { primary: research.content, secondary: implementation.content, files };
  }

  private async executeOpenCodeFirst(
    task: string,
    _analysis: TaskAnalysis
  ): Promise<{ primary: string; secondary: string; files: { path: string; action: string; content?: string }[] }> {
    const contextStr = this.graph.buildContextString('opencode');
    const implPrompt = `${task}\n\n## Knowledge Graph Context\n${contextStr}\n\nImplement the solution. Return JSON: {"files": [{"path": "filename.ext", "content": "..."}]}`;

    const implementation = await this.openCodeAgent.send(implPrompt);
    this.graph.recordAgentAction('opencode', 'implementation', implementation.content);

    const files = this.extractFiles(implementation.content, 'opencode');
    for (const file of files) {
      const content = file.content || this.extractContentFromResponse(implementation.content, file.path);
      this.graph.trackFile(file.path, content, 'opencode', 'created');
    }

    const reviewPrompt = `Review this implementation: ${implementation.content}\n\nFiles: ${files.map(f => `${f.path}`).join(', ')}\n\nCheck for correctness, potential bugs, and suggest improvements.`;

    let reviewContent = '';
    try {
      const review = await this.geminiAgent.send(reviewPrompt);
      reviewContent = isErrorResponse(review.content) ? '' : review.content;
      this.graph.recordAgentAction('gemini-cli', 'review', reviewContent || 'Gemini review skipped (unavailable)');
    } catch {
      this.graph.recordAgentAction('gemini-cli', 'review', 'Gemini review skipped (error)');
    }

    return { primary: implementation.content, secondary: reviewContent, files };
  }

  private async executeParallel(
    task: string,
    _analysis: TaskAnalysis
  ): Promise<{ primary: string; secondary: string; files: { path: string; action: string; content?: string }[] }> {
    const contextStr = this.graph.buildContextString('opencode');
    const geminiPrompt = `Quick research: ${task}\n\nProvide a brief plan and any critical considerations.`;
    const opencodePrompt = `Implement: ${task}\n\n## Context\n${contextStr}\n\nReturn JSON: {"files": [{"path": "filename.ext", "content": "..."}]}`;

    const [research, implementation] = await Promise.allSettled([
      this.geminiAgent.send(geminiPrompt),
      this.openCodeAgent.send(opencodePrompt),
    ]);

    const researchResult = research.status === 'fulfilled' ? research.value.content : '';
    const implResult = implementation.status === 'fulfilled' ? implementation.value.content : '';

    if (research.status === 'fulfilled') {
      this.graph.recordAgentAction('gemini-cli', 'research', researchResult);
    }
    if (implementation.status === 'fulfilled') {
      this.graph.recordAgentAction('opencode', 'implementation', implResult);
    }

    const files = this.extractFiles(implResult, 'opencode');

    return { primary: researchResult, secondary: implResult, files };
  }

  private async executeSwarm(
    task: string,
    _analysis: TaskAnalysis
  ): Promise<{ primary: string; secondary: string; files: { path: string; action: string; content?: string }[] }> {
    const contextStr = this.graph.buildContextString('opencode');

    const [geminiResult, opencodeResult] = await Promise.allSettled([
      this.geminiAgent.send(`Implement: ${task}\n\nCreate working code files. Be specific and precise.`),
      this.openCodeAgent.send(`${task}\n\n## Context\n${contextStr}\n\nReturn JSON: {"files": [{"path": "filename.ext", "content": "..."}]}`),
    ]);

    const geminiScore = this.scoreResult(geminiResult.status === 'fulfilled' ? geminiResult.value : null);
    const opencodeScore = this.scoreResult(opencodeResult.status === 'fulfilled' ? opencodeResult.value : null);

    const best = geminiScore >= opencodeScore ? geminiResult : opencodeResult;
    const bestAgent = geminiScore >= opencodeScore ? 'gemini-cli' : 'opencode';
    const worst = geminiScore >= opencodeScore ? opencodeResult : geminiResult;
    const worstAgent = geminiScore >= opencodeScore ? 'opencode' : 'gemini-cli';

    if (best.status === 'fulfilled') {
      this.graph.recordAgentAction(bestAgent, 'implementation', best.value.content, { swarmWinner: true });
    }
    if (worst.status === 'fulfilled') {
      this.graph.recordAgentAction(worstAgent, 'implementation-attempt', worst.value.content, { swarmRunnerUp: true });
    }

    const bestContent = best.status === 'fulfilled' ? best.value.content : '';
    const worstContent = worst.status === 'fulfilled' ? worst.value.content : 'No secondary result';
    const files = this.extractFiles(bestContent, bestAgent);

    return { primary: bestContent, secondary: worstContent, files };
  }

  private async validateOutput(
    result: {
      primary: string;
      secondary: string;
      files: { path: string; action: string; content?: string }[];
    },
    taskType?: TaskType
  ): Promise<{
    valid: boolean;
    output: string;
    files: { path: string; action: string; content?: string }[];
    errors: string[];
  }> {
    const errors: string[] = [];
    const finalOutput = result.secondary || result.primary;
    const validatedFiles = [...result.files];

    const expectsCode = !taskType || taskType === 'code' || taskType === 'refactor' || taskType === 'debug';

    if (expectsCode) {
      const hasRealCode = /```[\s\S]*?```/.test(finalOutput) ||
        /"content"\s*:\s*"[^"]*function|class|const|let|import|export|def |fn |func /i.test(finalOutput);

      if (!hasRealCode && result.files.length === 0) {
        errors.push('No actual code found in response — appears to be descriptions only');
      }
    }

    if (result.files.length > 0) {
      for (const file of result.files) {
        if (!file.path || file.path.includes('data.json') || file.path === 'output.txt') {
          errors.push(`Invalid filename: ${file.path} — appears to be a placeholder`);
        }

        if (file.path.includes('..') || file.path.startsWith('/')) {
          errors.push(`Path traversal attempt detected: ${file.path}`);
        }

        if (file.content && /sk-[a-zA-Z0-9]{20,}|api[_-]?key["\s]*[=:]["\s]*[a-zA-Z0-9]{20,}/i.test(file.content)) {
          errors.push(`Possible secret leak detected in ${file.path}`);
        }
      }
    }

    const codeBlocks = finalOutput.match(/```[\s\S]*?```/g) || [];

    for (const block of codeBlocks) {
      const langMatch = block.match(/```(\w+)/);
      const lang = langMatch ? langMatch[1] : 'unknown';
      const content = block.replace(/```\w*\n?/g, '').trim();

      if (lang === 'python' && !content.includes('\n')) {
        errors.push('Python code appears to be a single line — likely incomplete');
      }

      if (lang === 'javascript' || lang === 'typescript') {
        const openBraces = (content.match(/\{/g) || []).length;
        const closeBraces = (content.match(/\}/g) || []).length;
        if (Math.abs(openBraces - closeBraces) > 2) {
          errors.push('Imbalanced braces in JavaScript/TypeScript code');
        }
      }

      if (content.includes('// ...') || content.includes('pass  #') || content.includes('TODO')) {
        errors.push('Code contains placeholder comments — not complete implementation');
      }
    }

    const isValid = errors.length === 0;

    const taskNodes = this.graph.search({ tags: ['task'] }).nodes;
    if (taskNodes.length > 0) {
      this.graph.recordValidation(
        taskNodes[0].id,
        'eamilos-validation',
        isValid ? 'passed' : 'failed',
        isValid ? 'All checks passed' : errors.join('; ')
      );
    }

    return { valid: isValid, output: finalOutput, files: validatedFiles, errors };
  }

  private scoreResult(result: { content: string } | null): number {
    if (!result) return 0;

    let score = 30;
    const content = result.content;

    const codeBlockCount = (content.match(/```[\s\S]*?```/g) || []).length;
    score += Math.min(codeBlockCount * 10, 30);
    if (content.length > 200) score += 10;
    if (content.includes('"path"') || content.includes('filename')) score += 15;
    if (/function|class|const|import|export|def |fn /.test(content)) score += 15;

    return Math.min(100, score);
  }

  private extractFiles(content: string, _source: string): { path: string; action: string; content?: string }[] {
    const files: { path: string; action: string; content?: string }[] = [];

    try {
      const jsonMatch = content.match(/\{[\s\S]*"files"[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (Array.isArray(parsed.files)) {
          for (const file of parsed.files) {
            files.push({
              path: file.path || file.filename || 'unknown',
              action: 'created',
              content: file.content || file.code || '',
            });
          }
          return files;
        }
      }
    } catch {
      // not JSON, continue
    }

    const codeBlockPattern = /```(\w+)\s*(?:filename[=:]\s*["']?([^\s`"\n]+)["']?\s*)?\n?([\s\S]*?)```/g;
    let match;

    while ((match = codeBlockPattern.exec(content)) !== null) {
      const [, , filename, code] = match;
      if (filename) {
        files.push({ path: filename, action: 'created', content: code.trim() });
      }
    }

    const pathPattern = /(?:created|file|written)[:\s]+[`"]?([^\s`"\n]+(?:\.(ts|js|py|go|rs|java|cpp|c|json|yaml|md)))["`]?/gi;
    const pathMatches = content.matchAll(pathPattern);
    for (const match of pathMatches) {
      if (!files.find(f => f.path === match[1])) {
        files.push({ path: match[1], action: 'created' });
      }
    }

    return files;
  }

  private extractContentFromResponse(content: string, targetPath: string): string {
    const escapedPath = targetPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`\`\`\`\\w+\\s*(?:${escapedPath}\\s*)?\\n?([\\s\\S]*?)\`\`\``, 'i');
    const match = content.match(pattern);
    return match ? match[1].trim() : '';
  }

  async healthCheck(): Promise<{
    opencode: { available: boolean; version?: string; error?: string };
    gemini: { available: boolean; version?: string; error?: string };
    graph: { nodes: number; edges: number };
  }> {
    const [opencode, gemini] = await Promise.all([
      this.openCodeAgent.checkInstalled(),
      this.geminiAgent.checkInstalled(),
    ]);

    const stats = this.graph.getStats();
    return { opencode, gemini, graph: { nodes: stats.totalNodes, edges: stats.totalEdges } };
  }

  getGraph(): Graphify {
    return this.graph;
  }

  async terminate(): Promise<void> {
    await Promise.all([
      this.openCodeAgent.terminate().catch(() => {}),
      this.geminiAgent.terminate().catch(() => {}),
    ]);
  }
}
