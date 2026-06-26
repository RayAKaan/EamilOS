export type TaskType = 'code' | 'research' | 'analyze' | 'refactor' | 'debug' | 'general';

export interface TaskPlan {
  type: TaskType;
  complexity: 'low' | 'medium' | 'high';
  requiresResearch: boolean;
  requiresCodeGeneration: boolean;
  estimatedAgents: string[];
  suggestedStrategy: 'single' | 'fallback' | 'swarm';
  reasoning: string;
}

export class TaskPlanner {
  async analyze(task: string): Promise<TaskPlan> {
    return this.keywordBasedAnalysis(task);
  }

  private keywordBasedAnalysis(task: string): TaskPlan {
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

    let strategy: 'single' | 'fallback' | 'swarm';
    if (isResearch || complexity === 'high') strategy = 'swarm';
    else if (isDebug || isRefactor) strategy = 'fallback';
    else strategy = 'single';

    const estimatedAgents: string[] =
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
      reasoning: `Keyword-based analysis: type=${type}, complexity=${complexity}, strategy=${strategy}`,
    };
  }
}
