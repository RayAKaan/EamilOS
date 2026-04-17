import { z } from 'zod';

export const EventTypeEnum = z.enum([
  'project.created',
  'project.started',
  'project.completed',
  'project.failed',
  'project.paused',
  'project.resumed',
  'project.cancelled',
  'task.created',
  'task.ready',
  'task.assigned',
  'task.started',
  'task.completed',
  'task.failed',
  'task.retried',
  'task.approval_requested',
  'task.approved',
  'task.rejected',
  'task.cancelled',
  'task.interrupted',
  'artifact.created',
  'artifact.updated',
  'model.called',
  'model.failed',
  'model.fallback',
  'decision.made',
  'error.occurred',
  'permission.requested',
  'permission.granted',
  'permission.denied',
  'budget.warning',
  'budget.exceeded',
  'system.started',
  'system.shutdown',
  'system.recovery',
  'agent.question',
  'agent.answered',
]);

export type EventType = z.infer<typeof EventTypeEnum>;

export const EventSchema = z.object({
  id: z.string().min(1),
  timestamp: z.date(),
  type: EventTypeEnum,
  projectId: z.string().optional(),
  taskId: z.string().optional(),
  agentId: z.string().optional(),
  correlationId: z.string().optional(),
  data: z.record(z.unknown()),
  humanReadable: z.string().optional(),
});

export type SystemEvent = z.infer<typeof EventSchema>;

export interface EventCreate {
  type: EventType;
  projectId?: string;
  taskId?: string;
  agentId?: string;
  correlationId?: string;
  data?: Record<string, unknown>;
  humanReadable?: string;
}
