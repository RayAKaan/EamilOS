import { randomUUID } from 'crypto';
import { z } from 'zod';

export const ResourceAccessSchema = z.enum(['read', 'write', 'delete', 'execute']);
export type ResourceAccess = z.infer<typeof ResourceAccessSchema>;

export const ResourceClaimSchema = z.object({
  resource: z.string().min(1),
  access: ResourceAccessSchema,
  exclusive: z.boolean().default(false),
  reason: z.string().optional(),
});
export type ResourceClaim = z.infer<typeof ResourceClaimSchema>;

export const AgentTodoSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  order: z.number().int().nonnegative(),
  dependsOn: z.array(z.string()).default([]),
  acceptanceCriteria: z.array(z.string()).default([]),
  resources: z.array(ResourceClaimSchema).default([]),
  estimatedRisk: z.enum(['low', 'medium', 'high']).default('medium'),
});
export type AgentTodo = z.infer<typeof AgentTodoSchema>;

export const AgentPlanSchema = z.object({
  id: z.string().min(1),
  missionId: z.string().min(1),
  taskId: z.string().min(1),
  agentId: z.string().min(1),
  revision: z.number().int().positive().default(1),
  objective: z.string().min(1),
  todos: z.array(AgentTodoSchema).min(1),
  generatedAt: z.string().datetime(),
  metadata: z.record(z.unknown()).default({}),
});
export type AgentPlan = z.infer<typeof AgentPlanSchema>;

export interface AgentPlanInput {
  missionId: string;
  taskId: string;
  agentId: string;
  objective: string;
  todos: Omit<AgentTodo, 'id'>[];
  metadata?: Record<string, unknown>;
}

export function createAgentPlan(input: AgentPlanInput): AgentPlan {
  return AgentPlanSchema.parse({
    id: `plan_${randomUUID()}`,
    ...input,
    todos: input.todos.map((todo) => ({ ...todo, id: `todo_${randomUUID()}` })),
    generatedAt: new Date().toISOString(),
  });
}

export interface ResourceConflict {
  resource: string;
  plans: string[];
  accesses: ResourceAccess[];
  reason: string;
}

export interface PlanReconciliation {
  accepted: AgentPlan[];
  rejected: AgentPlan[];
  conflicts: ResourceConflict[];
  sequenced: Array<{ beforePlanId: string; afterPlanId: string; resources: string[] }>;
}
