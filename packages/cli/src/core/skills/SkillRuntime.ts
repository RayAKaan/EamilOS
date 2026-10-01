export interface SkillContext {
  readonly signal: AbortSignal;
  readonly agentId?: string;
  readonly input: unknown;
}

export interface SkillDefinition<TInput = unknown, TOutput = unknown> {
  readonly id: string;
  readonly version: string;
  readonly description: string;
  readonly tags?: readonly string[];
  readonly run: (ctx: SkillContext) => Promise<TOutput>;
  readonly validate?: (input: TInput) => void;
}

export interface SkillSnapshot {
  readonly id: string;
  readonly version: string;
  readonly description: string;
  readonly enabled: boolean;
  readonly tags: string[];
}

export class SkillRuntime {
  private readonly skills = new Map<string, SkillDefinition>();
  private readonly disabled = new Set<string>();

  register<TInput, TOutput>(skill: SkillDefinition<TInput, TOutput>): () => void {
    if (this.skills.has(skill.id)) throw new Error(`Skill already registered: ${skill.id}`);
    this.skills.set(skill.id, skill as SkillDefinition);
    return () => {
      this.skills.delete(skill.id);
      this.disabled.delete(skill.id);
    };
  }

  enable(id: string): void {
    this.require(id);
    this.disabled.delete(id);
  }

  disable(id: string): void {
    this.require(id);
    this.disabled.add(id);
  }

  has(id: string): boolean {
    return this.skills.has(id);
  }

  list(): SkillSnapshot[] {
    return [...this.skills.values()].sort((a, b) => a.id.localeCompare(b.id)).map(skill => ({
      id: skill.id,
      version: skill.version,
      description: skill.description,
      enabled: !this.disabled.has(skill.id),
      tags: [...(skill.tags ?? [])].sort(),
    }));
  }

  async run<TInput, TOutput>(id: string, input: TInput, options: { signal?: AbortSignal; agentId?: string } = {}): Promise<TOutput> {
    const skill = this.require(id) as SkillDefinition<TInput, TOutput>;
    if (this.disabled.has(id)) throw new Error(`Skill is disabled: ${id}`);
    skill.validate?.(input);
    const controller = new AbortController();
    const signal = options.signal;
    if (signal) {
      if (signal.aborted) controller.abort(signal.reason);
      else signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
    }
    return skill.run({ signal: controller.signal, agentId: options.agentId, input });
  }

  private require(id: string): SkillDefinition {
    const skill = this.skills.get(id);
    if (!skill) throw new Error(`Unknown skill: ${id}`);
    return skill;
  }
}
