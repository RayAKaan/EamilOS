import { z } from 'zod';

export const ProjectStatusEnum = z.enum([
  'active',
  'completed',
  'failed',
  'paused',
  'archived',
  'cancelled',
]);

export type ProjectStatus = z.infer<typeof ProjectStatusEnum>;

export const ProjectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  goal: z.string().min(1),
  status: ProjectStatusEnum,
  path: z.string().min(1),
  userContext: z.string().optional(),
  constraints: z.array(z.string()).optional(),
  template: z.string().optional(),
  totalTasks: z.number().int().min(0).default(0),
  completedTasks: z.number().int().min(0).default(0),
  failedTasks: z.number().int().min(0).default(0),
  totalTokensUsed: z.number().int().min(0).default(0),
  totalCostUsd: z.number().min(0).default(0),
  budgetUsd: z.number().min(0).optional(),
  createdAt: z.date(),
  startedAt: z.date().optional(),
  completedAt: z.date().optional(),
  pausedAt: z.date().optional(),
});

export type Project = z.infer<typeof ProjectSchema>;

export const PROJECT_TRANSITIONS: Record<string, string[]> = {
  active: ['completed', 'failed', 'paused', 'cancelled'],
  paused: ['active', 'cancelled'],
  failed: ['active'],
  completed: ['archived'],
  archived: [],
  cancelled: [],
};

export function validateProjectTransition(from: ProjectStatus, to: ProjectStatus): void {
  const allowed = PROJECT_TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) {
    throw new Error(
      `Cannot transition project from "${from}" to "${to}". ` +
      `Allowed transitions from "${from}": [${allowed?.join(', ') || 'none'}]`
    );
  }
}

export interface ProjectCreate {
  name: string;
  goal: string;
  path: string;
  userContext?: string;
  constraints?: string[];
  template?: string;
  budgetUsd?: number;
}
