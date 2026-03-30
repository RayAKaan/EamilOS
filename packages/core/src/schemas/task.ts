import { z } from 'zod';

export const TaskStatusEnum = z.enum([
  'pending',
  'ready',
  'in_progress',
  'completed',
  'failed',
  'blocked',
  'waiting_approval',
  'cancelled',
  'interrupted',
]);

export type TaskStatus = z.infer<typeof TaskStatusEnum>;

export const TaskTypeEnum = z.enum([
  'research',
  'coding',
  'qa',
  'planning',
  'design',
  'deploy',
  'custom',
]);

export type TaskType = z.infer<typeof TaskTypeEnum>;

export const TaskSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  type: TaskTypeEnum,
  status: TaskStatusEnum,
  priority: z.enum(['critical', 'high', 'medium', 'low']).default('medium'),
  dependsOn: z.array(z.string()),
  assignedAgent: z.string().optional(),
  requiredCapabilities: z.array(z.string()).optional(),
  inputContext: z.string().optional(),
  output: z.string().optional(),
  artifacts: z.array(z.string()),
  retryCount: z.number().int().min(0).default(0),
  maxRetries: z.number().int().min(0).default(3),
  requiresHumanApproval: z.boolean().default(false),
  tokenUsage: z.number().int().min(0).default(0),
  costUsd: z.number().min(0).default(0),
  error: z.string().optional(),
  lockedBy: z.string().optional(),
  correlationId: z.string().optional(),
  parentTaskId: z.string().optional(),
  createdAt: z.date(),
  startedAt: z.date().optional(),
  completedAt: z.date().optional(),
});

export type Task = z.infer<typeof TaskSchema>;

export const TASK_TRANSITIONS: Record<string, string[]> = {
  pending: ['ready', 'blocked', 'cancelled'],
  ready: ['in_progress', 'blocked', 'cancelled'],
  in_progress: ['completed', 'failed', 'ready', 'waiting_approval', 'interrupted'],
  waiting_approval: ['completed', 'ready', 'cancelled'],
  blocked: ['ready', 'cancelled'],
  failed: ['ready'],
  interrupted: ['ready'],
  completed: [],
  cancelled: [],
};

export function validateTaskTransition(from: TaskStatus, to: TaskStatus): void {
  const allowed = TASK_TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) {
    throw new Error(
      `Cannot transition task from "${from}" to "${to}". ` +
      `Allowed transitions from "${from}": [${allowed?.join(', ') || 'none'}]`
    );
  }
}

export interface TaskCreate {
  projectId: string;
  title: string;
  description: string;
  type: TaskType;
  priority?: 'critical' | 'high' | 'medium' | 'low';
  dependsOn?: string[];
  requiredCapabilities?: string[];
  inputContext?: string;
  requiresHumanApproval?: boolean;
  maxRetries?: number;
  parentTaskId?: string;
}
