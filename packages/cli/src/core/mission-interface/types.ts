import { z } from 'zod';
import type { MissionStatus } from '../mission/types.js';
import type { AutonomousLoopState, AutonomousLoopResult } from '../loop/types.js';

export const MissionAutonomySchema = z.enum(['ASSISTED', 'PLANNED', 'AUTONOMOUS']);
export type MissionAutonomy = z.infer<typeof MissionAutonomySchema>;

export const MissionControlActionSchema = z.enum([
  'START',
  'PLAN',
  'EXECUTE',
  'RETRY',
  'REASSIGN',
  'REPLAN',
  'VERIFY',
  'COMPLETE',
  'ESCALATE',
  'ABORT',
  'PUSH',
  'DEPLOY',
]);
export type MissionControlAction = z.infer<typeof MissionControlActionSchema>;

export const ApprovalStatusSchema = z.enum(['PENDING', 'APPROVED', 'DENIED', 'EXPIRED', 'CONSUMED']);
export type ApprovalStatus = z.infer<typeof ApprovalStatusSchema>;

export const MissionPolicySchema = z.object({
  autonomy: MissionAutonomySchema.default('AUTONOMOUS'),
  requireApprovalFor: z.array(MissionControlActionSchema).default([]),
  allowExecution: z.boolean().default(true),
  allowReplanning: z.boolean().default(true),
  allowTaskCreation: z.boolean().default(true),
  allowTaskCancellation: z.boolean().default(true),
  maxIterations: z.number().int().positive().default(100),
  maxReplans: z.number().int().nonnegative().default(10),
  stagnationThreshold: z.number().int().positive().default(5),
});
export type MissionPolicy = z.infer<typeof MissionPolicySchema>;

export const ApprovalRequestSchema = z.object({
  id: z.string().min(1),
  missionId: z.string().min(1),
  action: MissionControlActionSchema,
  status: ApprovalStatusSchema,
  reason: z.string().min(1),
  taskId: z.string().optional(),
  requestedAt: z.string().datetime(),
  resolvedAt: z.string().datetime().optional(),
  resolvedBy: z.string().optional(),
  consumedAt: z.string().datetime().optional(),
});
export type ApprovalRequest = z.infer<typeof ApprovalRequestSchema>;

export interface MissionStatusView {
  missionId: string;
  goal: string;
  status: MissionStatus;
  autonomy: MissionAutonomy;
  progress: {
    totalTasks: number;
    completedTasks: number;
    runningTasks: number;
    readyTasks: number;
    blockedTasks: number;
    failedTasks: number;
    completionRatio: number;
  };
  loop?: AutonomousLoopState;
  graph: {
    version: number;
    stateHash: string;
    consistent: boolean;
    nodes: number;
    edges: number;
  };
  approvals: ApprovalRequest[];
}

export interface MissionStartResult {
  started: boolean;
  missionId: string;
  approval?: ApprovalRequest;
  result?: MissionRunResult;
}

export interface MissionRunResult {
  missionId: string;
  status: MissionStatus;
  loop: AutonomousLoopResult;
}

export type MissionAskIntent =
  | 'STATUS'
  | 'PAUSE'
  | 'RESUME'
  | 'CANCEL'
  | 'REPLAN'
  | 'VERIFY'
  | 'APPROVE'
  | 'DENY'
  | 'BLOCKERS'
  | 'DASHBOARD'
  | 'REPORT'
  | 'WHY'
  | 'EVENTS'
  | 'HELP'
  | 'UNKNOWN';

export interface MissionAskResult {
  intent: MissionAskIntent;
  message: string;
  data?: unknown;
}
