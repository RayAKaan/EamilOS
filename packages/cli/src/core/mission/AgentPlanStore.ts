import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { AgentPlanSchema, type AgentPlan } from './AgentPlan.js';

export class AgentPlanStore {
  constructor(private readonly baseDir = join(process.cwd(), '.eamilos', 'agent-plans')) {
    mkdirSync(baseDir, { recursive: true });
  }

  save(plan: AgentPlan): void {
    const parsed = AgentPlanSchema.parse(plan);
    const target = join(this.baseDir, `${parsed.id}.json`);
    const temp = `${target}.tmp.${process.pid}.${Date.now()}`;
    writeFileSync(temp, JSON.stringify(parsed, null, 2), 'utf8');
    renameSync(temp, target);
  }

  get(id: string): AgentPlan | null {
    const target = join(this.baseDir, `${id}.json`);
    if (!existsSync(target)) return null;
    return AgentPlanSchema.parse(JSON.parse(readFileSync(target, 'utf8')));
  }

  listForTask(taskId: string): AgentPlan[] {
    if (!existsSync(this.baseDir)) return [];
    return readdirSync(this.baseDir)
      .filter((name) => name.endsWith('.json'))
      .map((name) => {
        try {
          return AgentPlanSchema.parse(JSON.parse(readFileSync(join(this.baseDir, name), 'utf8')));
        } catch {
          return null;
        }
      })
      .filter((plan): plan is AgentPlan => plan !== null && plan.taskId === taskId);
  }
}
