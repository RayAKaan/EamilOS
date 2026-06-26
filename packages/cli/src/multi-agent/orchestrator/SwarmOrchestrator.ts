import { EventEmitter } from 'events';
import { OpenCodeAgent } from '../agents/OpenCodeAgent.js';
import { GeminiCliAgent } from '../agents/GeminiCliAgent.js';
import { ClaudeCodeAgent } from '../agents/ClaudeCodeAgent.js';
import { AiderAgent } from '../agents/AiderAgent.js';
import { GooseAgent } from '../agents/GooseAgent.js';
import { BaseAgent, TerminalMessage } from '../agents/BaseAgent.js';
import { Graphify, KGNode } from '../graph/Graphify.js';
import { ConflictArbiter, type ArtifactCandidate, type ArtifactResolution } from '../../core/comms/ConflictArbiter.js';

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
    'not available', 'timeout', 'timed out', 'permission denied',
    'not installed', 'google_api_key', 'invalid',
    'fallback failed', 'fetch failed', 'error:',
  ];

  return errorPatterns.some(pattern => lower.includes(pattern.toLowerCase()));
}

export const EAMILOS_SWARM_SYSTEM_PROMPT = `
[EamilOS 1.6.0 — Unified Autonomous Multi-Agent Kernel]
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
  estimatedAgents: ('opencode' | 'gemini-cli' | 'claude-code' | 'aider' | 'goose')[];
  suggestedStrategy: ExecutionStrategy;
  reasoning: string;
}

export interface HealthCheckResult {
  opencode: { available: boolean; version?: string; error?: string };
  gemini: { available: boolean; version?: string; error?: string };
  claudeCode: { available: boolean; version?: string; error?: string };
  aider: { available: boolean; version?: string; error?: string };
  goose: { available: boolean; version?: string; error?: string };
  graph: { nodes: number; edges: number };
}

export class SwarmOrchestrator extends EventEmitter {
  private openCodeAgent: OpenCodeAgent;
  private geminiAgent: GeminiCliAgent;
  private claudeAgent: ClaudeCodeAgent;
  private aiderAgent: AiderAgent;
  private gooseAgent: GooseAgent;
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

    const agentOpts = {
      workingDir: this.config.workingDir,
      env: this.config.env,
      timeoutMs: this.config.timeoutMs,
    };

    this.openCodeAgent = new OpenCodeAgent(agentOpts);
    this.geminiAgent = new GeminiCliAgent(agentOpts);
    this.claudeAgent = new ClaudeCodeAgent(agentOpts);
    this.aiderAgent = new AiderAgent(agentOpts);
    this.gooseAgent = new GooseAgent(agentOpts);

    this.graph = new Graphify();

    const forwardChunk = (agentName: string) => (_agent: string, chunk: string) => {
      this.emit('agent.output', agentName, chunk);
    };

    this.geminiAgent.on('chunk', forwardChunk('gemini-cli'));
    this.openCodeAgent.on('chunk', forwardChunk('opencode'));
    this.claudeAgent.on('chunk', forwardChunk('claude-code'));
    this.aiderAgent.on('chunk', forwardChunk('aider'));
    this.gooseAgent.on('chunk', forwardChunk('goose'));

    this.graph.createAgentNode('opencode', 'OpenCode Agent', [
      'code-generation', 'refactoring', 'multi-model', 'file-editing', 'open-source',
    ]);
    this.graph.createAgentNode('gemini-cli', 'Gemini CLI Agent', [
      'research', 'analysis', 'fast-iteration', 'web-search', 'long-context',
    ]);
    this.graph.createAgentNode('claude-code', 'Claude Code Agent', [
      'autonomous-coding', 'deep-reasoning', 'architectural-design', 'refactoring',
    ]);
    this.graph.createAgentNode('aider', 'Aider Agent', [
      'pair-programming', 'git-integration', 'multi-file-edit', 'ast-aware',
    ]);
    this.graph.createAgentNode('goose', 'Goose Agent', [
      'autonomous-automation', 'tool-orchestration', 'developer-workflows',
    ]);
  }

  async healthCheck(): Promise<HealthCheckResult> {
    const [opencode, gemini, claudeCode, aider, goose] = await Promise.all([
      this.openCodeAgent.checkInstalled(),
      this.geminiAgent.checkInstalled(),
      this.claudeAgent.checkInstalled(),
      this.aiderAgent.checkInstalled(),
      this.gooseAgent.checkInstalled(),
    ]);

    const graphStats = this.graph.getStats();

    return {
      opencode,
      gemini,
      claudeCode,
      aider,
      goose,
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

    const estimatedAgents: ('opencode' | 'gemini-cli' | 'claude-code' | 'aider' | 'goose')[] =
      isCode ? ['opencode', 'claude-code', 'gemini-cli'] :
      isRefactor ? ['claude-code', 'opencode'] :
      isDebug ? ['opencode', 'claude-code', 'aider'] :
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
          result.validated = false;
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

  private async getBestAvailableCodingAgent(): Promise<{ send: (msg: string) => Promise<TerminalMessage>; name: string }> {
    const agents = [
      { check: this.claudeAgent.checkInstalled(), send: this.claudeAgent.send.bind(this.claudeAgent), name: 'claude-code' },
      { check: this.openCodeAgent.checkInstalled(), send: this.openCodeAgent.send.bind(this.openCodeAgent), name: 'opencode' },
      { check: this.aiderAgent.checkInstalled(), send: this.aiderAgent.send.bind(this.aiderAgent), name: 'aider' },
      { check: this.gooseAgent.checkInstalled(), send: this.gooseAgent.send.bind(this.gooseAgent), name: 'goose' },
      { check: this.geminiAgent.checkInstalled(), send: this.geminiAgent.send.bind(this.geminiAgent), name: 'gemini-cli' },
    ];

    const results = await Promise.allSettled(agents.map(a => a.check));
    for (let i = 0; i < agents.length; i++) {
      if (results[i].status === 'fulfilled' && (results[i] as PromiseFulfilledResult<any>).value.available) {
        return { send: agents[i].send, name: agents[i].name };
      }
    }
    return { send: this.openCodeAgent.send.bind(this.openCodeAgent), name: 'opencode' };
  }

  private async getBestAvailableResearchAgent(): Promise<{ send: (msg: string) => Promise<TerminalMessage>; name: string }> {
    const agents = [
      { check: this.geminiAgent.checkInstalled(), send: this.geminiAgent.send.bind(this.geminiAgent), name: 'gemini-cli' },
      { check: this.claudeAgent.checkInstalled(), send: this.claudeAgent.send.bind(this.claudeAgent), name: 'claude-code' },
      { check: this.openCodeAgent.checkInstalled(), send: this.openCodeAgent.send.bind(this.openCodeAgent), name: 'opencode' },
      { check: this.aiderAgent.checkInstalled(), send: this.aiderAgent.send.bind(this.aiderAgent), name: 'aider' },
    ];

    const results = await Promise.allSettled(agents.map(a => a.check));
    for (let i = 0; i < agents.length; i++) {
      if (results[i].status === 'fulfilled' && (results[i] as PromiseFulfilledResult<any>).value.available) {
        return { send: agents[i].send, name: agents[i].name };
      }
    }
    return { send: this.openCodeAgent.send.bind(this.openCodeAgent), name: 'opencode' };
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
    let usedAgent = 'gemini-cli';

    try {
      const researchResponse = await this.geminiAgent.send(researchPrompt);
      if (!isErrorResponse(researchResponse.content) && !researchResponse.content.includes('failed:')) {
        research = researchResponse.content;
        researchSuccess = true;
        this.graph.recordAgentAction('gemini-cli', 'research', research);
      } else {
        throw new Error(researchResponse.content);
      }
    } catch (err) {
      const fallback = await this.getBestAvailableResearchAgent();
      usedAgent = fallback.name;
      this.emit('system.event', `[Dynamic Swarm Routing] Gemini agent unresponsive -> Delegating task to ${fallback.name} agent`);
      const fbRes = await fallback.send(researchPrompt);
      research = fbRes.content;
      researchSuccess = true;
    }

    if (!researchSuccess) {
      try {
        const fallback = await this.getBestAvailableResearchAgent();
        const plan = await fallback.send(
          `Analyze and plan: ${task}\n\nProvide a clear implementation plan with specific files to create and steps to follow.`
        );
        research = plan.content;
        this.graph.recordAgentAction(fallback.name, 'planning', research);
      } catch (err) {
        research = task;
      }
    }

    const codingAgent = await this.getBestAvailableCodingAgent();
    let contextStr = this.graph.buildContextString(codingAgent.name);

    const implementationPrompt = analysis.requiresCodeGeneration
      ? `${research}\n\n## Previous Context\n${contextStr}\n\nNow implement the solution. Create actual working files with real code. Return JSON:\n{"files": [{"path": "filename.ext", "content": "..."}]}`
      : research;

    let implementation = '';
    try {
      const implResponse = await codingAgent.send(implementationPrompt);
      implementation = implResponse.content;
      this.graph.recordAgentAction(codingAgent.name, 'implementation', implementation);
    } catch (err) {
      implementation = `Implementation failed: ${(err as Error).message}`;
      this.graph.recordError(`${codingAgent.name} implementation failed`, 'eamilos', { error: (err as Error).message });
    }

    const files = this.extractFiles(implementation, codingAgent.name);

    return {
      output: { primary: research, secondary: implementation, files },
      agent: `gemini-first (impl: ${codingAgent.name})`,
    };
  }

  private async executeOpenCodeFirst(
    task: string,
    analysis: TaskAnalysis
  ): Promise<{ output: { primary: string; secondary: string; files: any[] }; agent: string }> {

    const codingAgent = await this.getBestAvailableCodingAgent();
    let contextStr = this.graph.buildContextString(codingAgent.name);

    const implPrompt = `${task}\n\n## Context\n${contextStr}\n\nImplement the solution. Return JSON:\n{"files": [{"path": "filename.ext", "content": "..."}]}`;

    let implementation = '';
    let implementationSuccess = false;
    let usedAgent = codingAgent.name;

    try {
      const implResponse = await codingAgent.send(implPrompt);
      if (isErrorResponse(implResponse.content) || implResponse.content.includes('failed:')) {
        throw new Error(implResponse.content);
      }
      implementation = implResponse.content;
      implementationSuccess = true;
    } catch (err) {
      const fallbackCoding = await this.getBestAvailableCodingAgent();
      if (fallbackCoding.name !== usedAgent) {
        usedAgent = fallbackCoding.name;
        this.emit('system.event', `[Dynamic Swarm Routing] ${codingAgent.name} unresponsive -> Delegating to ${fallbackCoding.name} agent`);
        const fbRes = await fallbackCoding.send(implPrompt);
        implementation = fbRes.content;
      } else {
        const gemRes = await this.geminiAgent.send(implPrompt);
        implementation = gemRes.content;
        usedAgent = 'gemini-cli';
      }
    }

    const files = this.extractFiles(implementation, usedAgent);

    for (const file of files) {
      const content = file.content || this.extractContentFromResponse(implementation, file.path);
      this.graph.trackFile(file.path, content, usedAgent, 'created');
    }

    let review = '';
    try {
      const reviewAgent = await this.getBestAvailableResearchAgent();
      const reviewPrompt = analysis.type === 'debug'
        ? `Debug and fix issues in:\n${implementation}\n\nFiles: ${files.map(f => f.path).join(', ')}\n\nProvide corrected code.`
        : `Review this implementation:\n${implementation}\n\nFiles: ${files.map(f => f.path).join(', ')}\n\nCheck for correctness, potential bugs, and suggest improvements.`;

      const reviewResponse = await reviewAgent.send(reviewPrompt);

      if (!isErrorResponse(reviewResponse.content)) {
        review = reviewResponse.content;
        this.graph.recordAgentAction(reviewAgent.name, 'review', review);

        if (review.includes('fix') || review.includes('should be') || review.includes('incorrect')) {
          this.graph.recordConcept('Code Review', reviewAgent.name, review.slice(0, 300));
        }
      } else {
        review = '(Review unavailable)';
      }
    } catch {
      review = '(Review unavailable)';
    }

    return {
      output: { primary: implementation, secondary: review, files },
      agent: usedAgent,
    };
  }

  private async executeParallel(
    task: string,
    _analysis: TaskAnalysis
  ): Promise<{ output: { primary: string; secondary: string; files: any[] }; agent: string }> {

    const researchAgent = await this.getBestAvailableResearchAgent();
    const codingAgent = await this.getBestAvailableCodingAgent();

    const contextStr = this.graph.buildContextString(codingAgent.name);

    const researchPrompt = `Quick analysis: ${task}\n\nProvide a brief plan and any critical considerations. Be concise.`;
    const implementPrompt = `Implement: ${task}\n\n## Context\n${contextStr}\n\nReturn JSON:\n{"files": [{"path": "filename.ext", "content": "..."}]}`;

    const [researchPromise, implementationPromise] = await Promise.allSettled([
      researchAgent.send(researchPrompt),
      codingAgent.send(implementPrompt),
    ]);

    let research = '';
    if (researchPromise.status === 'fulfilled' && !isErrorResponse(researchPromise.value.content)) {
      research = researchPromise.value.content;
      this.graph.recordAgentAction(researchAgent.name, 'research', research);
    }

    let implementation = '';
    if (implementationPromise.status === 'fulfilled') {
      implementation = implementationPromise.value.content;
      this.graph.recordAgentAction(codingAgent.name, 'implementation', implementation);
    }

    if (!implementation && research) {
      try {
        const fallbackImpl = await codingAgent.send(`Based on this plan:\n${research}\n\nImplement it. Return JSON:\n{"files": [{"path": "filename.ext", "content": "..."}]}`);
        implementation = fallbackImpl.content;
        this.graph.recordAgentAction(codingAgent.name, 'implementation (fallback)', implementation);
      } catch {}
    }

    const files = this.extractFiles(implementation, codingAgent.name);

    return {
      output: { primary: research, secondary: implementation, files },
      agent: `${researchAgent.name}+${codingAgent.name} (parallel)`,
    };
  }

  private async executeSwarm(
    task: string,
    _analysis: TaskAnalysis
  ): Promise<{ output: { primary: string; secondary: string; files: any[] }; agent: string }> {

    const codingAgent1 = await this.getBestAvailableCodingAgent();
    const agents = [codingAgent1];

    const secondAgent = codingAgent1.name === 'claude-code'
      ? await this.getBestAvailableResearchAgent()
      : { send: this.claudeAgent.send.bind(this.claudeAgent), name: 'claude-code' };

    const agent2Check = await this.claudeAgent.checkInstalled();
    if (agent2Check.available && codingAgent1.name !== 'claude-code') {
      agents.push({ send: this.claudeAgent.send.bind(this.claudeAgent), name: 'claude-code' });
    } else {
      const research = await this.getBestAvailableResearchAgent();
      if (research.name !== codingAgent1.name) {
        agents.push(research);
      } else {
        agents.push({ send: this.geminiAgent.send.bind(this.geminiAgent), name: 'gemini-cli' });
      }
    }

    const contextStr = this.graph.buildContextString(codingAgent1.name);

    const agent1Prompt = `Implement: ${task}\n\n## Context\n${contextStr}\n\nCreate working code files. Be specific and precise. Return JSON:\n{"files": [{"path": "filename.ext", "content": "..."}]}`;
    const agent2Prompt = `Implement: ${task}\n\nCreate working code files. Be specific and precise. Return the code directly.`;

    const [result1, result2] = await Promise.allSettled([
      agents[0].send(agent1Prompt),
      agents[1].send(agent2Prompt),
    ]);

    const content1 = result1.status === 'fulfilled' ? result1.value.content : '';
    const content2 = result2.status === 'fulfilled' ? result2.value.content : '';

    const agent1Name = agents[0].name;
    const agent2Name = agents[1].name;

    const agent1Files = this.extractFiles(content1, agent1Name);
    const agent2Files = this.extractFiles(content2, agent2Name);

    // Group files by path for conflict detection
    const allPaths = new Set<string>();
    for (const f of agent1Files) allPaths.add(f.path);
    for (const f of agent2Files) allPaths.add(f.path);

    const mergedFiles: { path: string; action: string; content?: string }[] = [];
    const arbiter = new ConflictArbiter();

    for (const path of allPaths) {
      const candidate1 = agent1Files.find(f => f.path === path);
      const candidate2 = agent2Files.find(f => f.path === path);

      if (candidate1 && candidate2) {
        const candidates: ArtifactCandidate[] = [
          {
            callsign: agent1Name,
            path,
            hash: ConflictArbiter.computeHash(agent1Name, path, candidate1.content || ''),
            content: candidate1.content || '',
          },
          {
            callsign: agent2Name,
            path,
            hash: ConflictArbiter.computeHash(agent2Name, path, candidate2.content || ''),
            content: candidate2.content || '',
          },
        ];

        try {
          const resolution: ArtifactResolution = await arbiter.arbitrate(candidates);
          mergedFiles.push({
            path: resolution.winner.path,
            action: 'created',
            content: resolution.winner.content,
          });

          this.emit('arbiter', {
            path,
            method: resolution.method,
            callsign: resolution.winner.callsign,
            reason: resolution.reason,
          });
        } catch {
          mergedFiles.push(candidate1);
        }
      } else {
        mergedFiles.push(candidate1 || candidate2!);
      }
    }

    const score1 = this.scoreResult(content1 ? { content: content1 } : null);
    const score2 = this.scoreResult(content2 ? { content: content2 } : null);

    const bestContent = score1 >= score2 ? content1 : content2;
    const worstContent = score1 >= score2 ? content2 : content1;
    const winner = score1 >= score2 ? agent1Name : agent2Name;

    this.graph.recordAgentAction(winner, 'swarm-winner', bestContent, {
      score: Math.max(score1, score2)
    });

    if (worstContent) {
      const loserName = winner === agent1Name ? agent2Name : agent1Name;
      this.graph.recordAgentAction(
        loserName,
        'swarm-runner-up',
        worstContent,
        { score: Math.min(score1, score2) }
      );
    }

    return {
      output: { primary: bestContent, secondary: worstContent || 'No runner-up result', files: mergedFiles },
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
    const finalOutput = result.files.length > 0 ? result.primary : (result.primary || result.secondary);
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
      this.claudeAgent.terminate(),
      this.aiderAgent.terminate(),
      this.gooseAgent.terminate(),
    ]);
  }
}
