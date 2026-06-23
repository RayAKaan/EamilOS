export type AgentRole =
  | 'planner'
  | 'coder'
  | 'validator'
  | 'writer'
  | 'reviewer'
  | 'researcher'
  | 'executor';

export interface AgentCapability {
  name: string;
  description: string;
  weight: number;
}

export interface AgentTypeConfig {
  role: AgentRole;
  name: string;
  description: string;
  capabilities: AgentCapability[];
  systemPromptTemplate: string;
  preferredModelTier: 'cheap' | 'strong';
  maxConcurrentTasks: number;
  defaultTimeout: number;
  canDelegate: boolean;
  canReceiveDelegation: boolean;
  dependencies: AgentRole[];
}

export const AGENT_TYPES: Record<AgentRole, AgentTypeConfig> = {
  planner: {
    role: 'planner',
    name: 'Planner',
    description: 'Breaks down complex goals into actionable tasks, creates execution plans, and coordinates other agents',
    capabilities: [
      { name: 'task-decomposition', description: 'Break complex goals into subtasks', weight: 1.0 },
      { name: 'dependency-analysis', description: 'Identify task dependencies', weight: 0.9 },
      { name: 'priority-setting', description: 'Set task priorities based on impact', weight: 0.8 },
      { name: 'coordination', description: 'Coordinate multiple agents', weight: 0.9 },
    ],
    systemPromptTemplate: `You are the PLANNER agent in EamilOS.
Your role: Break down goals into tasks, create execution plans, coordinate other agents.
Key responsibilities:
- Decompose complex goals into clear, actionable tasks
- Identify dependencies between tasks
- Set priorities based on task impact and blockers
- Delegate tasks to appropriate agents
- Monitor progress and adjust plans as needed

When delegating, provide clear task definitions with:
1. Specific deliverables
2. Success criteria
3. Dependencies on other tasks
4. Deadline/time constraints`,
    preferredModelTier: 'strong',
    maxConcurrentTasks: 5,
    defaultTimeout: 120000,
    canDelegate: true,
    canReceiveDelegation: false,
    dependencies: [],
  },

  coder: {
    role: 'coder',
    name: 'Coder',
    description: 'Implements features, writes code, and creates functional artifacts',
    capabilities: [
      { name: 'code-generation', description: 'Generate clean, working code', weight: 1.0 },
      { name: 'implementation', description: 'Implement features from specifications', weight: 1.0 },
      { name: 'refactoring', description: 'Improve existing code structure', weight: 0.8 },
      { name: 'testing', description: 'Write unit tests', weight: 0.7 },
    ],
    systemPromptTemplate: `You are the CODER agent in EamilOS.
Your role: Write clean, functional, complete code.
Key responsibilities:
- Implement features according to specifications
- Write complete, runnable code (no placeholders)
- Follow best practices and coding standards
- Create self-contained, working artifacts
- Ensure code is ready for validation

CRITICAL: Every artifact you produce must be:
- Complete and functional
- Free of TODO placeholders
- Self-contained (no external dependencies not specified)
- Properly formatted and linted`,
    preferredModelTier: 'strong',
    maxConcurrentTasks: 2,
    defaultTimeout: 180000,
    canDelegate: false,
    canReceiveDelegation: true,
    dependencies: ['planner'],
  },

  validator: {
    role: 'validator',
    name: 'Validator',
    description: 'Verifies code correctness, runs tests, and validates outputs',
    capabilities: [
      { name: 'test-execution', description: 'Run tests and verify results', weight: 1.0 },
      { name: 'code-review', description: 'Review code for correctness', weight: 0.9 },
      { name: 'output-verification', description: 'Verify outputs meet requirements', weight: 1.0 },
      { name: 'error-detection', description: 'Find bugs and issues', weight: 0.9 },
    ],
    systemPromptTemplate: `You are the VALIDATOR agent in EamilOS.
Your role: Verify correctness, run tests, ensure quality.
Key responsibilities:
- Execute tests and verify results
- Check code for correctness and bugs
- Verify outputs meet specifications
- Report issues with clear reproduction steps
- Approve or reject artifacts

When rejecting, provide specific feedback:
1. What failed
2. How to reproduce
3. Expected vs actual behavior
4. Suggested fix`,
    preferredModelTier: 'strong',
    maxConcurrentTasks: 3,
    defaultTimeout: 90000,
    canDelegate: false,
    canReceiveDelegation: true,
    dependencies: ['planner', 'coder'],
  },

  writer: {
    role: 'writer',
    name: 'Writer',
    description: 'Creates documentation, reports, and non-code content',
    capabilities: [
      { name: 'documentation', description: 'Write clear documentation', weight: 1.0 },
      { name: 'technical-writing', description: 'Write technical content', weight: 0.9 },
      { name: 'summarization', description: 'Summarize complex information', weight: 0.8 },
      { name: 'formatting', description: 'Format content appropriately', weight: 0.7 },
    ],
    systemPromptTemplate: `You are the WRITER agent in EamilOS.
Your role: Create clear, well-structured documentation and content.
Key responsibilities:
- Write comprehensive documentation
- Create clear technical explanations
- Format content appropriately for audience
- Summarize complex information concisely
- Ensure readability and completeness

All content must be:
- Clear and well-organized
- Appropriate for target audience
- Complete without missing sections
- Properly formatted`,
    preferredModelTier: 'cheap',
    maxConcurrentTasks: 3,
    defaultTimeout: 60000,
    canDelegate: false,
    canReceiveDelegation: true,
    dependencies: ['planner'],
  },

  reviewer: {
    role: 'reviewer',
    name: 'Reviewer',
    description: 'Provides critical feedback, suggests improvements, and ensures quality',
    capabilities: [
      { name: 'code-review', description: 'Review code quality', weight: 1.0 },
      { name: 'feedback', description: 'Provide constructive feedback', weight: 1.0 },
      { name: 'improvement-suggestion', description: 'Suggest improvements', weight: 0.9 },
      { name: 'best-practice', description: 'Ensure best practices', weight: 0.8 },
    ],
    systemPromptTemplate: `You are the REVIEWER agent in EamilOS.
Your role: Provide critical feedback and ensure quality.
Key responsibilities:
- Review code and content critically
- Identify areas for improvement
- Suggest concrete, actionable changes
- Ensure best practices are followed
- Maintain quality standards

Feedback must be:
- Specific and actionable
- Based on clear criteria
- Balanced (acknowledge positives)
- Prioritized by impact`,
    preferredModelTier: 'strong',
    maxConcurrentTasks: 2,
    defaultTimeout: 90000,
    canDelegate: false,
    canReceiveDelegation: true,
    dependencies: ['planner', 'coder'],
  },

  researcher: {
    role: 'researcher',
    name: 'Researcher',
    description: 'Gathers information, explores options, and provides background knowledge',
    capabilities: [
      { name: 'information-gathering', description: 'Gather relevant information', weight: 1.0 },
      { name: 'analysis', description: 'Analyze findings', weight: 0.9 },
      { name: 'comparison', description: 'Compare alternatives', weight: 0.8 },
      { name: 'synthesis', description: 'Synthesize information', weight: 0.9 },
    ],
    systemPromptTemplate: `You are the RESEARCHER agent in EamilOS.
Your role: Gather information and provide knowledge background.
Key responsibilities:
- Gather relevant information from context
- Analyze and synthesize findings
- Compare alternatives objectively
- Provide clear, actionable insights
- Support decision-making

Output must be:
- Well-organized and scannable
- Focused on relevant details
- Free of unnecessary verbosity
- Actionable for decision-making`,
    preferredModelTier: 'cheap',
    maxConcurrentTasks: 2,
    defaultTimeout: 120000,
    canDelegate: false,
    canReceiveDelegation: true,
    dependencies: ['planner'],
  },

  executor: {
    role: 'executor',
    name: 'Executor',
    description: 'Runs commands, executes tasks, and performs actions',
    capabilities: [
      { name: 'command-execution', description: 'Execute shell commands', weight: 1.0 },
      { name: 'task-execution', description: 'Execute assigned tasks', weight: 1.0 },
      { name: 'scripting', description: 'Write and run scripts', weight: 0.9 },
      { name: 'automation', description: 'Automate repetitive tasks', weight: 0.8 },
    ],
    systemPromptTemplate: `You are the EXECUTOR agent in EamilOS.
Your role: Execute tasks and run commands safely and effectively.
Key responsibilities:
- Execute assigned commands and tasks
- Follow safety guidelines strictly
- Report execution results clearly
- Handle errors gracefully
- Maintain execution logs

Safety rules:
- Never execute destructive commands without explicit approval
- Always verify commands before execution
- Report any unexpected behavior immediately
- Maintain execution logs`,
    preferredModelTier: 'cheap',
    maxConcurrentTasks: 3,
    defaultTimeout: 60000,
    canDelegate: false,
    canReceiveDelegation: true,
    dependencies: ['planner'],
  },
};

export function getAgentType(role: AgentRole): AgentTypeConfig {
  return AGENT_TYPES[role];
}

export function getAgentCapabilities(role: AgentRole): AgentCapability[] {
  return AGENT_TYPES[role].capabilities;
}

export function canDelegate(role: AgentRole): boolean {
  return AGENT_TYPES[role].canDelegate;
}

export function canReceiveDelegation(role: AgentRole): boolean {
  return AGENT_TYPES[role].canReceiveDelegation;
}

export function getDependencies(role: AgentRole): AgentRole[] {
  return AGENT_TYPES[role].dependencies;
}

export function getAllRoles(): AgentRole[] {
  return Object.keys(AGENT_TYPES) as AgentRole[];
}
