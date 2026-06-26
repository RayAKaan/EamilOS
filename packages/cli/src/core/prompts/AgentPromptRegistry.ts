import type { AgentMode } from '../agents/types.js';

export type PromptRole =
  | 'planner'
  | 'researcher'
  | 'coder'
  | 'reviewer'
  | 'tester'
  | 'security'
  | 'debugger'
  | 'orchestrator';

export interface PromptKey {
  role: PromptRole;
  mode: AgentMode;
  agentId?: string;
}

const ROLE_DESCRIPTIONS: Record<PromptRole, string> = {
  planner: 'You are an expert software architect and planner.',
  researcher: 'You are an expert research analyst.',
  coder: 'You are an expert software engineer.',
  reviewer: 'You are an expert code reviewer.',
  tester: 'You are an expert test engineer.',
  security: 'You are an expert security auditor.',
  debugger: 'You are an expert debugger.',
  orchestrator: 'You are the EamilOS orchestration coordinator.',
};

const COMMUNICATION_CONSTRAINTS = `
IMPORTANT CONSTRAINTS:
- Do not modify files.
- Do not run mutating commands.
- Return proposed patches or plans only.
- You are in read-only analysis mode.`;

const EXECUTION_CONSTRAINTS = `
IMPORTANT CONSTRAINTS:
- You may modify files only inside the workspace/staging area.
- Report every changed file.
- Do not touch secrets, .env, .git internals, or external paths.
- All changes must be verified before final application.`;

const MODE_CONSTRAINTS: Record<AgentMode, string> = {
  communication: COMMUNICATION_CONSTRAINTS,
  execution: EXECUTION_CONSTRAINTS,
};

const JSON_OUTPUT_FORMAT = `
Respond with valid JSON:
{
  "summary": "Brief description of what was done",
  "files": [
    {
      "path": "relative/path.ext",
      "content": "Complete file content"
    }
  ]
}

ABSOLUTE RULES:
1. Output MUST be valid JSON parseable by JSON.parse()
2. Output MUST contain a "files" array with at least one entry
3. Each file MUST have "path" and "content"
4. "content" must contain the COMPLETE file content
5. Do not wrap JSON in markdown code blocks
6. Do not add text before or after the JSON`;

const ROLE_INSTRUCTIONS: Record<PromptRole, string> = {
  planner: `
Your task is to analyze the goal and produce a detailed architecture plan.
Break the work into clear subtasks with dependencies.
Identify required capabilities, roles, and modes for each subtask.
Output a structured plan as JSON.`,
  researcher: `
Your task is to research the topic and gather relevant information.
Find best practices, libraries, documentation, and examples.
Provide a comprehensive research summary with actionable recommendations.`,
  coder: `
Your task is to implement the solution.
Write complete, production-ready code with proper error handling.
Follow the architecture plan if provided.
Ensure all code is type-safe and follows project conventions.`,
  reviewer: `
Your task is to review the code for correctness, performance, and style.
Check for potential bugs, security issues, and edge cases.
Provide specific, actionable feedback.`,
  tester: `
Your task is to write comprehensive tests.
Cover unit tests, integration tests, and edge cases.
Ensure high test coverage for the implemented code.
Follow the existing test patterns in the project.`,
  security: `
Your task is to audit the code for security vulnerabilities.
Check for: injection flaws, auth bypasses, data exposure, insecure defaults.
Provide a security report with severity ratings and fix recommendations.`,
  debugger: `
Your task is to debug and fix issues in the code.
Identify root causes of failures.
Implement targeted fixes with proper error handling.
Verify that fixes resolve the original issue.`,
  orchestrator: `
Your task is to coordinate the multi-agent execution.
Track progress across subtasks.
Handle fallbacks when agents fail.
Ensure the overall goal is achieved.`,
};

export function getSystemPrompt(key: PromptKey): string {
  const role = key.role || 'coder';
  const mode = key.mode || 'execution';

  const parts: string[] = [
    `[EamilOS 1.6.0 — Unified Autonomous Multi-Agent Kernel]`,
    ``,
    ROLE_DESCRIPTIONS[role],
    ``,
    ROLE_INSTRUCTIONS[role],
    ``,
    MODE_CONSTRAINTS[mode],
    ``,
    JSON_OUTPUT_FORMAT,
  ];

  if (key.agentId) {
    parts.push(``);
    parts.push(`You are running as agent: ${key.agentId}.`);
  }

  return parts.join('\n');
}

export function getPlannerPrompt(goal: string): string {
  return `Analyze this task and create a detailed execution plan.

Task: "${goal}"

Break this down into specific subtasks. For each subtask, specify:
1. What needs to be done
2. Required capabilities (codeGeneration, fileEditing, commandExecution, webResearch, longContext)
3. Suggested role (planner, researcher, coder, reviewer, tester, security, debugger)
4. Whether it can run in parallel with other subtasks
5. Whether it needs communication (read-only) or execution (read-write) mode

Respond with valid JSON:
{
  "summary": "Brief plan summary",
  "subtasks": [
    {
      "title": "Subtask title",
      "description": "What to do",
      "requiredCapabilities": ["codeGeneration"],
      "suggestedRole": "coder",
      "dependencies": [],
      "canRunInParallel": false,
      "modeRequired": "execution"
    }
  ]
}`;
}
