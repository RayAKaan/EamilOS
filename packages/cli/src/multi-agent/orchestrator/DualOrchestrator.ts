import { EventEmitter } from 'events';
import { OpenCodeAgent } from '../agents/OpenCodeAgent.js';
import { GeminiCliAgent } from '../agents/GeminiCliAgent.js';
import { Graphify, KGNode } from '../graph/Graphify.js';
import { TerminalMessage } from '../agents/BaseAgent.js';

export function isErrorResponse(content: string): boolean {
  if (!content || content.length > 5000) return false;

  try {
    const parsed = JSON.parse(content);
    if (parsed.error || parsed.errorMessage || parsed.errorType) return true;
  } catch {}

  const lower = content.toLowerCase();
  const errorPatterns = [
    'authentication', 'auth method', 'api.key', 'not configured',
    'command not found', 'enoent', 'spawn', 'enode',
    'not available', 'timeout', 'permission denied',
    'not installed', 'google_api_key', 'invalid',
  ];

  return errorPatterns.some(pattern => lower.includes(pattern.toLowerCase()));
}

export const EAMILOS_SWARM_SYSTEM_PROMPT = `
[EamilOS 1.4.0 — Unified Autonomous Multi-Agent Kernel]
You are operating as a specialized intelligence node within EamilOS, pooling the collective execution power of OpenCode AI (75+ models & code synthesis) and Gemini CLI (multimodal long-context research) into a single unified agent system.
Your supreme directive is to generate verified, validated, production-ready working code.
Guaranteed Execution Protocols:
1. MAX POWER SYNTHESIS: Leverage complete architectural implementation, comprehensive error handling, modular design patterns, and strict security compliance.
2. NO PLACEHOLDERS: Never output conceptual descriptions, "TODO: implement later", or temporary filenames like data.json/temp.js.
3. STRUCTURED OUTPUT: For coding goals, respond directly with valid JSON:
{
  "summary": "Architectural overview of working solution",
  "files": [
    {
      "path": "relative/path/filename.ext",
      "content": "# Complete working production code...",
      "language": "programming_language"
    }
  ]
}
`.trim();

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
  agentUsed?: string;
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

export interface HealthCheckResult {
  opencode: { available: boolean; version?: string; error?: string };
  gemini: { available: boolean; version?: string; error?: string };
  graph: { nodes: number; edges: number };
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
      timeoutMs: 240000,
      ...config,
      workingDir: config.workingDir || process.cwd(),
    };

    this.openCodeAgent = new OpenCodeAgent({
      workingDir: this.config.workingDir,
      env: this.config.env,
      timeoutMs: this.config.timeoutMs,
    });

    this.geminiAgent = new GeminiCliAgent({
      workingDir: this.config.workingDir,
      env: this.config.env,
      timeoutMs: this.config.timeoutMs,
    });

    this.graph = new Graphify();

    // Forward chunk events from agents
    this.geminiAgent.on('chunk', (agent: string, chunk: string) => {
      this.emit('agent.output', agent, chunk);
    });
    this.openCodeAgent.on('chunk', (agent: string, chunk: string) => {
      this.emit('agent.output', agent, chunk);
    });

    this.graph.createAgentNode('opencode', 'OpenCode Agent', [
      'code-generation', 'refactoring', 'multi-model', 'file-editing', 'open-source',
    ]);
    this.graph.createAgentNode('gemini-cli', 'Gemini CLI Agent', [
      'research', 'analysis', 'fast-iteration', 'web-search', 'long-context',
    ]);
  }

  async healthCheck(): Promise<HealthCheckResult> {
    const [opencode, gemini] = await Promise.all([
      this.openCodeAgent.checkInstalled(),
      this.geminiAgent.checkInstalled(),
    ]);

    const graphStats = this.graph.getStats();

    return {
      opencode,
      gemini,
      graph: { nodes: graphStats.totalNodes, edges: graphStats.totalEdges },
    };
  }

  async analyzeTask(task: string): Promise<TaskAnalysis> {
    try {
      const analysis = await this.geminiAgent.send(
        `Analyze this task and respond with ONLY valid JSON (no markdown, no explanation):
{
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

      if (!isErrorResponse(analysis.content) && analysis.content.length < 2000) {
        try {
          const jsonMatch = analysis.content.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]) as TaskAnalysis;
            if (parsed.type && parsed.suggestedStrategy) {
              return parsed;
            }
          }
        } catch {
        }
      }
    } catch {
    }

    return this.keywordBasedAnalysis(task);
  }

  private keywordBasedAnalysis(task: string): TaskAnalysis {
    const taskLower = task.toLowerCase();

    const isResearch = /\b(analyze|research|explain|find|search|look up|what is|how does|describe|compare|review)\b/i.test(task);
    const isCode = /\b(build|create|implement|write|generate|code|function|class|api|app|file|script|program|module)\b/i.test(task);
    const isRefactor = /\b(refactor|restructure|redesign|rewrite|migrate|convert|update)\b/i.test(task);
    const isDebug = /\b(fix|debug|error|bug|issue|problem|broken|failing|exception)\b/i.test(task);

    let type: TaskType = 'general';
    if (isDebug) type = 'debug';
    else if (isRefactor) type = 'refactor';
    else if (isCode) type = 'code';
    else if (isResearch) type = 'research';

    const complexity: 'low' | 'medium' | 'high' =
      task.length > 300 ? 'high' :
      task.length > 150 ? 'medium' : 'low';

    let strategy: ExecutionStrategy = 'opencode-first';
    if (isResearch) strategy = 'gemini-first';
    else if (isDebug) strategy = 'opencode-first';
    else if (isRefactor) strategy = 'opencode-first';
    else if (isCode && complexity === 'high') strategy = 'parallel';

    const estimatedAgents: ('opencode' | 'gemini-cli')[] =
      isCode ? ['opencode', 'gemini-cli'] :
      isResearch ? ['gemini-cli'] :
      ['opencode'];

    return {
      type,
      complexity,
      requiresResearch: isResearch,
      requiresCodeGeneration: isCode || isRefactor,
      estimatedAgents,
      suggestedStrategy: strategy,
      reasoning: 'Keyword-based analysis: ' +
        `type=${type}, complexity=${complexity}, strategy=${strategy}`,
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
    this.emit('orchestrator.started', { task, taskId: taskNode.id, strategy: result.strategy });

    let analysis: TaskAnalysis;
    try {
      analysis = await this.analyzeTask(task);
      result.strategy = forceStrategy || analysis.suggestedStrategy;
    } catch (err) {
      analysis = this.keywordBasedAnalysis(task);
      result.strategy = forceStrategy || this.config.strategy;
    }

    this.graph.updateNode(taskNode.id, {
      properties: { ...taskNode.properties, analysis },
    });

    const maxRetries = this.config.maxRetries || 3;

    while (result.attempts < maxRetries && !result.success) {
      result.attempts++;

      this.emit('agent.started', result.strategy === 'gemini-first' ? 'gemini' : 'opencode');

      try {
        let execResult;
        let usedAgent = 'unknown';

        switch (result.strategy) {
          case 'gemini-first':
            const geminiResult = await this.executeGeminiFirst(task, analysis);
            execResult = geminiResult.output;
            usedAgent = geminiResult.agent;
            break;

          case 'opencode-first':
            const opencodeResult = await this.executeOpenCodeFirst(task, analysis);
            execResult = opencodeResult.output;
            usedAgent = opencodeResult.agent;
            break;

          case 'parallel':
            const parallelResult = await this.executeParallel(task, analysis);
            execResult = parallelResult.output;
            usedAgent = parallelResult.agent;
            break;

          case 'swarm':
            const swarmResult = await this.executeSwarm(task, analysis);
            execResult = swarmResult.output;
            usedAgent = swarmResult.agent;
            break;

          default:
            const defaultResult = await this.executeOpenCodeFirst(task, analysis);
            execResult = defaultResult.output;
            usedAgent = defaultResult.agent;
        }

        result.agentUsed = usedAgent;
        result.primaryResult = execResult.primary;
        result.secondaryResult = execResult.secondary;

        this.emit('agent.completed', usedAgent, execResult.primary || execResult.secondary);
        this.emit('graph.node', { type: 'result', agent: usedAgent });
        this.emit('graph.edge', { from: taskNode.id, to: 'result' });

        const validationResult = await this.validateOutput(execResult, analysis.type);

        this.emit('validation.started', {});

        if (validationResult.valid) {
          result.success = true;
          result.finalOutput = validationResult.output;
          result.files = validationResult.files;
          result.validated = true;

          this.emit('validation.passed', {});

          for (const file of result.files) {
            this.graph.trackFile(file.path, file.content || '', usedAgent, file.action as 'created' | 'modified' | 'deleted');
            this.graph.recordValidation(file.path, 'eamilos-validation', 'passed', 'File validated');
          }

          this.graph.completeTask(taskNode.id, result.finalOutput || '');
          this.emit('task:completed', { taskId: taskNode.id, attempts: result.attempts, agent: usedAgent });
          this.emit('orchestrator.done', { duration: Date.now() - startTime, strategy: result.strategy, success: true });
        } else {
          this.graph.recordError(
            `Validation failed: ${validationResult.errors.join(', ')}`,
            'eamilos',
            { attempt: result.attempts, taskId: taskNode.id }
          );

          task = `${task}\n\nIMPORTANT: Previous attempt had these issues: ${validationResult.errors.join('; ')}. Please correct them.`;
          result.errors.push(...validationResult.errors);

          this.graph.recordAgentAction(usedAgent, 'implementation-retry', execResult.secondary, { attempt: result.attempts, errors: validationResult.errors });
        }

      } catch (err) {
        const errorMsg = (err as Error).message;
        result.errors.push(errorMsg);
        this.graph.recordError(errorMsg, 'orchestrator', { attempt: result.attempts });
        this.emit('orchestrator.error', errorMsg);
      }
    }

    result.duration = Date.now() - startTime;

    if (!result.success && result.errors.length > 0) {
      this.graph.updateNode(taskNode.id, {
        properties: { ...taskNode.properties, status: 'failed', errors: result.errors },
      });
      this.emit('task:failed', { taskId: taskNode.id, errors: result.errors });
      this.emit('orchestrator.error', result.errors.join('; '));
    }

    return result;
  }

  /**
   * Wraps an agent send() with a 3-second gauntlet timeout.
   * If the CLI binary hangs, lacks credentials, or encounters a network error,
   * EamilOS intercepts the failure, logs a self-healing reroute event, and
   * falls back to the internal ProviderManager kernel.
   */
  private async sendWithGauntlet(
    agent: 'opencode' | 'gemini-cli',
    message: string,
    signal?: AbortSignal
  ): Promise<TerminalMessage> {
    const agentObj = agent === 'opencode' ? this.openCodeAgent : this.geminiAgent;

    try {
      const result = await Promise.race([
        agentObj.send(message),
        new Promise<TerminalMessage>((_, reject) => {
          const timer = setTimeout(() => reject(new Error(`Gauntlet 3s timeout for ${agent} — CLI binary unavailable, hanging, or lacks credentials`)), 3000);
          if (signal) signal.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('Aborted')); }, { once: true });
        }),
      ]);
      return result;
    } catch (err) {
      const reason = (err as Error).message;

      this.emit('orchestrator.reroute', { agent, reason });
      this.graph.recordAgentAction(agent, 'gauntlet-timeout', reason.length > 200 ? reason.slice(0, 200) : reason);

      try {
        const { getProviderManager } = await import('../../core/provider-manager.js');
        const pm = getProviderManager();
        const systemPrompt = agent === 'opencode'
          ? 'You are OpenCode, an elite code-generation agent inside the EamilOS unified swarm. Output working production-ready code files as JSON: {"files": [{"path": "...", "content": "..."}]}. Never output descriptions or placeholders.'
          : 'You are Gemini CLI, an elite research and analysis agent inside the EamilOS unified swarm. Focus on analysis, planning, and review. Be concise and provide structured output.';

        const result = await pm.chat([
          { role: 'system', content: systemPrompt },
          { role: 'user', content: message },
        ]);

        const content = result.content || '(empty kernel response)';
        return {
          id: `${agent}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          timestamp: Date.now(),
          content,
          raw: content,
          metadata: { kernelFallback: true, gauntletReroute: true, duration: 0 },
        };
      } catch (innerErr) {
        return {
          id: `${agent}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          timestamp: Date.now(),
          content: `Kernel fallback failed: ${(innerErr as Error).message}`,
          raw: '',
          metadata: { kernelFallback: true, gauntletReroute: true, error: (innerErr as Error).message },
        };
      }
    }
  }

  private async executeGeminiFirst(
    task: string,
    analysis: TaskAnalysis
  ): Promise<{ output: { primary: string; secondary: string; files: any[] }; agent: string }> {

    const researchPrompt = analysis.requiresResearch
      ? `Research and plan: ${task}\n\nProvide a clear plan with specific steps, any files that need to be created/modified, and key considerations. Be specific and actionable.`
      : task;

    let research = '';
    let researchSuccess = false;

    try {
      const researchResponse = await this.sendWithGauntlet('gemini-cli', researchPrompt);
      if (!isErrorResponse(researchResponse.content)) {
        research = researchResponse.content;
        researchSuccess = true;

        this.graph.recordAgentAction('gemini-cli', 'research', research, {
          taskId: this.graph.search({ labelContains: task }).nodes[0]?.id
        });

        this.graph.recordConcept(`Research: ${task.slice(0, 50)}`, 'gemini-cli', research.slice(0, 500));
      }
    } catch (err) {
      this.graph.recordError('Gemini research failed', 'eamilos', { error: (err as Error).message });
    }

    if (!researchSuccess) {
      try {
        const opencodePlan = await this.sendWithGauntlet('opencode',
          `Analyze and plan: ${task}\n\nProvide a clear implementation plan with specific files to create and steps to follow.`
        );
        research = opencodePlan.content;
        this.graph.recordAgentAction('opencode', 'planning', research);
      } catch (err) {
        research = task;
      }
    }

    let contextStr = this.graph.buildContextString('opencode');

    const implementationPrompt = analysis.requiresCodeGeneration
      ? `${research}\n\n## Previous Context\n${contextStr}\n\nNow implement the solution. Create actual working files with real code. Return JSON:\n{"files": [{"path": "filename.ext", "content": "..."}]}`
      : research;

    let implementation = '';
    try {
      const implResponse = await this.sendWithGauntlet('opencode', implementationPrompt);
      implementation = implResponse.content;
      this.graph.recordAgentAction('opencode', 'implementation', implementation);
    } catch (err) {
      implementation = `Implementation failed: ${(err as Error).message}`;
      this.graph.recordError('OpenCode implementation failed', 'eamilos', { error: (err as Error).message });
    }

    const files = this.extractFiles(implementation, 'opencode');

    return {
      output: { primary: research, secondary: implementation, files },
      agent: 'gemini-cli+opencode',
    };
  }

  private async executeOpenCodeFirst(
    task: string,
    analysis: TaskAnalysis
  ): Promise<{ output: { primary: string; secondary: string; files: any[] }; agent: string }> {

    let contextStr = this.graph.buildContextString('opencode');

    const implPrompt = `${task}\n\n## Context\n${contextStr}\n\nImplement the solution. Return JSON:\n{"files": [{"path": "filename.ext", "content": "..."}]}`;

    let implementation = '';
    let implementationSuccess = false;

    try {
      const implResponse = await this.sendWithGauntlet('opencode', implPrompt);
      implementation = implResponse.content;
      implementationSuccess = true;
      this.graph.recordAgentAction('opencode', 'implementation', implementation);
    } catch (err) {
      implementation = `Implementation failed: ${(err as Error).message}`;
      this.graph.recordError('OpenCode implementation failed', 'eamilos', { error: (err as Error).message });
    }

    const files = this.extractFiles(implementation, 'opencode');

    for (const file of files) {
      const content = file.content || this.extractContentFromResponse(implementation, file.path);
      this.graph.trackFile(file.path, content, 'opencode', 'created');
    }

    let review = '';
    try {
      const reviewPrompt = analysis.type === 'debug'
        ? `Debug and fix issues in:\n${implementation}\n\nFiles: ${files.map(f => f.path).join(', ')}\n\nProvide corrected code.`
        : `Review this implementation:\n${implementation}\n\nFiles: ${files.map(f => f.path).join(', ')}\n\nCheck for correctness, potential bugs, and suggest improvements.`;

      const reviewResponse = await this.sendWithGauntlet('gemini-cli', reviewPrompt);

      if (!isErrorResponse(reviewResponse.content)) {
        review = reviewResponse.content;
        this.graph.recordAgentAction('gemini-cli', 'review', review);

        if (review.includes('fix') || review.includes('should be') || review.includes('incorrect')) {
          this.graph.recordConcept('Code Review', 'gemini-cli', review.slice(0, 300));
        }
      } else {
        review = '(Gemini review unavailable)';
      }
    } catch {
      review = '(Gemini review unavailable)';
    }

    return {
      output: { primary: implementation, secondary: review, files },
      agent: 'opencode',
    };
  }

  private async executeParallel(
    task: string,
    _analysis: TaskAnalysis
  ): Promise<{ output: { primary: string; secondary: string; files: any[] }; agent: string }> {

    const contextStr = this.graph.buildContextString('opencode');

    const geminiPrompt = `Quick analysis: ${task}\n\nProvide a brief plan and any critical considerations. Be concise.`;
    const opencodePrompt = `Implement: ${task}\n\n## Context\n${contextStr}\n\nReturn JSON:\n{"files": [{"path": "filename.ext", "content": "..."}]}`;

    const [researchPromise, implementationPromise] = await Promise.allSettled([
      this.sendWithGauntlet('gemini-cli', geminiPrompt),
      this.sendWithGauntlet('opencode', opencodePrompt),
    ]);

    let research = '';
    if (researchPromise.status === 'fulfilled' && !isErrorResponse(researchPromise.value.content)) {
      research = researchPromise.value.content;
      this.graph.recordAgentAction('gemini-cli', 'research', research);
    }

    let implementation = '';
    if (implementationPromise.status === 'fulfilled') {
      implementation = implementationPromise.value.content;
      this.graph.recordAgentAction('opencode', 'implementation', implementation);
    }

    if (!implementation && research) {
      try {
        const fallbackImpl = await this.sendWithGauntlet('opencode', `Based on this plan:\n${research}\n\nImplement it. Return JSON:\n{"files": [{"path": "filename.ext", "content": "..."}]}`);
        implementation = fallbackImpl.content;
        this.graph.recordAgentAction('opencode', 'implementation (fallback)', implementation);
      } catch {}
    }

    const files = this.extractFiles(implementation, 'opencode');

    return {
      output: { primary: research, secondary: implementation, files },
      agent: 'gemini-cli+opencode (parallel)',
    };
  }

  private async executeSwarm(
    task: string,
    _analysis: TaskAnalysis
  ): Promise<{ output: { primary: string; secondary: string; files: any[] }; agent: string }> {

    const contextStr = this.graph.buildContextString('opencode');

    const geminiPrompt = `Implement: ${task}\n\nCreate working code files. Be specific and precise. Return the code directly.`;
    const opencodePrompt = `Implement: ${task}\n\n## Context\n${contextStr}\n\nReturn JSON:\n{"files": [{"path": "filename.ext", "content": "..."}]}`;

    const [geminiResult, opencodeResult] = await Promise.allSettled([
      this.sendWithGauntlet('gemini-cli', geminiPrompt),
      this.sendWithGauntlet('opencode', opencodePrompt),
    ]);

    const geminiContent = geminiResult.status === 'fulfilled' ? geminiResult.value.content : '';
    const opencodeContent = opencodeResult.status === 'fulfilled' ? opencodeResult.value.content : '';

    const geminiScore = this.scoreResult(geminiContent ? { content: geminiContent } : null);
    const opencodeScore = this.scoreResult(opencodeContent ? { content: opencodeContent } : null);

    const bestContent = geminiScore >= opencodeScore ? geminiContent : opencodeContent;
    const worstContent = geminiScore >= opencodeScore ? opencodeContent : geminiContent;
    const winner = geminiScore >= opencodeScore ? 'gemini-cli' : 'opencode';

    this.graph.recordAgentAction(winner, 'swarm-winner', bestContent, {
      score: Math.max(geminiScore, opencodeScore)
    });

    if (worstContent) {
      this.graph.recordAgentAction(
        winner === 'gemini-cli' ? 'opencode' : 'gemini-cli',
        'swarm-runner-up',
        worstContent,
        { score: Math.min(geminiScore, opencodeScore) }
      );
    }

    const files = this.extractFiles(bestContent, winner);

    return {
      output: { primary: bestContent, secondary: worstContent || 'No runner-up result', files },
      agent: `swarm (winner: ${winner})`,
    };
  }

  private async validateOutput(
    result: { primary: string; secondary: string; files: any[] },
    taskType?: TaskType
  ): Promise<{
    valid: boolean;
    output: string;
    files: any[];
    errors: string[];
  }> {
    const errors: string[] = [];
    const finalOutput = result.files.length > 0 ? result.primary : (result.secondary || result.primary);
    const validatedFiles = [...result.files];

    const expectsCode = !taskType ||
      taskType === 'code' ||
      taskType === 'refactor' ||
      taskType === 'debug';

    if (expectsCode) {
      const hasCodeBlocks = /```[\s\S]*?```/.test(finalOutput);
      const hasCodePatterns = /function|class|const|let|import|export|def |fn |func |=>|{|}/.test(finalOutput);

      if (!hasCodeBlocks && !hasCodePatterns && result.files.length === 0) {
        errors.push('No actual code found — appears to be descriptions only');
      }
    }

    if (result.files.length > 0) {
      for (const file of result.files) {
        if (!file.path || file.path.length < 3) {
          errors.push(`Invalid path: ${file.path}`);
        }

        const placeholderNames = ['data.json', 'output.txt', 'temp.txt', 'file.txt', 'code.py'];
        if (placeholderNames.some(p => file.path.toLowerCase().includes(p))) {
          errors.push(`Placeholder filename detected: ${file.path}`);
        }

        if (file.path.includes('..') || file.path.startsWith('/') || file.path.startsWith('\\')) {
          errors.push(`Path traversal attempt detected: ${file.path}`);
        }

        if (file.content) {
          if (/sk-[a-zA-Z0-9]{20,}/i.test(file.content)) {
            errors.push(`Possible API key leak in ${file.path}`);
          }
          if (/api[_-]?key["\s]*[=:]["\s]*[a-zA-Z0-9]{20,}/i.test(file.content)) {
            errors.push(`Possible API key pattern in ${file.path}`);
          }
        }
      }
    }

    const codeBlocks = finalOutput.match(/```[\s\S]*?```/g) || [];

    for (const block of codeBlocks) {
      const langMatch = block.match(/```(\w+)/);
      const lang = langMatch ? langMatch[1] : 'unknown';
      const content = block.replace(/```\w*\n?/g, '').trim();

      if (lang === 'python' && content.includes('\n') === false && content.length > 50) {
        errors.push('Python code appears to be a single line — likely incomplete');
      }

      if (lang === 'javascript' || lang === 'typescript') {
        const openBraces = (content.match(/\{/g) || []).length;
        const closeBraces = (content.match(/\}/g) || []).length;
        if (Math.abs(openBraces - closeBraces) > 1) {
          errors.push(`Imbalanced braces in ${lang} code (${openBraces} open, ${closeBraces} close)`);
        }
      }

      if (content.includes('// ...') || content.includes('pass  #') ||
          content.includes('TODO') && content.length < 100) {
        errors.push('Code contains placeholder comments — not complete');
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
    score += Math.min(codeBlockCount * 15, 45);

    if (content.length > 200) score += 10;
    if (content.length > 1000) score += 5;

    if (content.includes('"path"') || /filename[:\s]+/i.test(content)) score += 15;

    if (/function|class|const|import|export|def |fn |async /.test(content)) score += 10;

    if (isErrorResponse(content)) score -= 40;

    return Math.max(0, Math.min(100, score));
  }

  private extractFiles(content: string, source: string): { path: string; action: string; content?: string }[] {
    const files: { path: string; action: string; content?: string }[] = [];

    try {
      const jsonMatch = content.match(/\{[\s\S]*"files"[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (Array.isArray(parsed.files)) {
          return parsed.files.map((f: any) => ({
            path: f.path || f.filename || 'unknown',
            action: 'created',
            content: f.content || f.code || '',
          }));
        }
        if (typeof parsed.files === 'object') {
          return [{
            path: parsed.files.path || parsed.files.filename || 'unknown',
            action: 'created',
            content: parsed.files.content || parsed.files.code || '',
          }];
        }
      }
    } catch {}

    const codeBlockPattern = /```(\w+)\s*(?:filename[=:]\s*["']?([^\s`"\n]+)["']?\s*)?\n?([\s\S]*?)```/g;
    let match;

    while ((match = codeBlockPattern.exec(content)) !== null) {
      const [, , filename, code] = match;
      if (filename) {
        files.push({
          path: filename,
          action: 'created',
          content: code.trim(),
        });
      }
    }

    const pathPatterns = [
      /(?:created|modified|wrote|saved)[:\s]+[`"']?([^\s`"'\n]+(?:\.[a-z]{2,6}))[`"']?/gi,
      /`([^\s`]+\.(ts|js|tsx|jsx|py|go|rs|java|cpp|c|h))`/gi,
    ];

    for (const pattern of pathPatterns) {
      let pathMatch;
      while ((pathMatch = pattern.exec(content)) !== null) {
        const path = pathMatch[1];
        if (!files.find(f => f.path === path) && !path.includes('node_modules')) {
          files.push({ path, action: 'created' });
        }
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

  /** Alias for execute(), used by the TUI */
  run = this.execute.bind(this);

  getGraph(): Graphify {
    return this.graph;
  }

  async terminate(): Promise<void> {
    await Promise.allSettled([
      this.openCodeAgent.terminate(),
      this.geminiAgent.terminate(),
    ]);
  }
}
