import { Project, Task, AgentDefinition, ContextSection } from './types.js';
import { Logger, getLogger } from './logger.js';

const MAX_CONTEXT_RATIO = 0.75;

export class ContextBuilder {
  private logger: Logger;

  constructor() {
    this.logger = getLogger();
  }

  async buildContext(
    project: Project,
    task: Task,
    agent: AgentDefinition,
    modelContextWindow: number
  ): Promise<string> {
    this.logger.debug(`Building context for task: ${task.id}`);

    const sections: ContextSection[] = [];

    sections.push({
      priority: 1,
      label: 'system',
      content: this.getSystemPrompt(agent),
      required: true,
    });

    sections.push({
      priority: 2,
      label: 'task',
      content: this.formatTaskDefinition(project, task),
      required: true,
    });

    sections.push({
      priority: 6,
      label: 'enforcement',
      content: this.getArtifactEnforcement(),
      required: true,
    });

    const maxTokens = Math.floor(modelContextWindow * MAX_CONTEXT_RATIO);
    return this.assembleWithBudget(sections, maxTokens);
  }

  private getSystemPrompt(agent: AgentDefinition): string {
    return `### EAMILOS SYSTEM INSTRUCTIONS

You are operating inside EamilOS (Agentic Operating Ground).
This is an execution environment, not a chat interface.

CORE LAWS (VIOLATION = TASK FAILURE):
1. ARTIFACT-FIRST: You MUST produce tangible files using provided tools. Chat-only output is failure.
2. CONTEXT-AWARE: You MUST read dependency outputs and workspace files before acting.
3. DOWNSTREAM-SAFE: Your outputs MUST be complete and usable by subsequent agents.
4. DECISIVE: Make reasonable assumptions. Do not ask questions. Execute.
5. BOUNDED: Stay within your role. Do not exceed your permissions.

FAILURE CONDITIONS (ANY ONE = TASK FAILURE):
- Returning only text explanation without writing files
- Producing files with placeholders or pseudo-code
- Ignoring provided context or dependency outputs
- Producing empty files
- Exceeding budget or permission boundaries

YOUR RESPONSE MUST:
1. Briefly state your plan (2-3 sentences max)
2. Use tools to write ALL artifacts to the workspace
3. Summarize: what was created, what decisions were made, what the next agent needs to know

${agent.systemPrompt}`;
  }

  private formatTaskDefinition(project: Project, task: Task): string {
    const parts: string[] = [
      `# PROJECT: ${project.name}`,
      `Goal: ${project.goal}`,
    ];

    if (project.userContext) {
      parts.push(`User Preferences: ${project.userContext}`);
    }

    if (project.constraints && project.constraints.length > 0) {
      parts.push(`Constraints: ${project.constraints.join(', ')}`);
    }

    parts.push('', `# YOUR TASK: ${task.title}`, `Type: ${task.type}`, `Priority: ${task.priority}`, `Description: ${task.description}`);

    return parts.join('\n');
  }

  private getArtifactEnforcement(): string {
    return `
# ⚠️ ARTIFACT ENFORCEMENT
You MUST use tools to write files to the workspace.
Failure to produce artifacts will result in task retry with increased pressure.
Do NOT output code in your response text. Write it to files.
Every file must be COMPLETE and FUNCTIONAL.`;
  }

  private assembleWithBudget(sections: ContextSection[], maxTokens: number): string {
    const result: string[] = [];
    let usedTokens = 0;

    const sorted = [...sections].sort((a, b) => a.priority - b.priority);

    for (const section of sorted) {
      const tokens = this.estimateTokens(section.content);

      if (section.required) {
        result.push(section.content);
        usedTokens += tokens;
      } else if (usedTokens + tokens <= maxTokens) {
        result.push(section.content);
        usedTokens += tokens;
      } else {
        const remaining = maxTokens - usedTokens;
        if (remaining > 200) {
          const truncated = this.truncateToTokens(section.content, remaining);
          result.push(truncated + `\n[${section.label} truncated due to context limit]`);
        }
        break;
      }
    }

    return result.join('\n\n');
  }

  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  private truncateToTokens(text: string, maxTokens: number): string {
    const maxChars = maxTokens * 4;
    if (text.length <= maxChars) {
      return text;
    }
    return text.slice(0, maxChars);
  }
}

let globalContextBuilder: ContextBuilder | null = null;

export function initContextBuilder(): ContextBuilder {
  globalContextBuilder = new ContextBuilder();
  return globalContextBuilder;
}

export function getContextBuilder(): ContextBuilder {
  if (!globalContextBuilder) {
    return initContextBuilder();
  }
  return globalContextBuilder;
}
