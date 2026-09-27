import { z } from 'zod';

export const GraphNodeTypeSchema = z.enum([
  'MISSION','TASK','EXECUTION','DEVICE','CAPABILITY','RESOURCE','MODEL','HARNESS',
  'ARTIFACT','EVIDENCE','VALIDATION','FAILURE','DECISION','CHECKPOINT','GIT_BRANCH','GIT_COMMIT',
]);
export type GraphNodeType = z.infer<typeof GraphNodeTypeSchema>;

export const GraphEdgeTypeSchema = z.enum([
  'CONTAINS','DEPENDS_ON','REQUIRES','AVAILABLE_ON','EXECUTED_BY','USES','PRODUCES',
  'VALIDATED_BY','INVALIDATED_BY','CAUSED_BY','RECOVERED_BY','DECIDED_BY','BLOCKS',
  'UNBLOCKS','DERIVED_FROM','SUPERSEDES','CHECKPOINTED_BY','RUNS_ON','ASSIGNED_TO',
  'BRANCHED_FROM','COMMITTED_AS',
]);
export type GraphEdgeType = z.infer<typeof GraphEdgeTypeSchema>;

export const GraphSourceKindSchema = z.enum([
  'MISSION','COORDINATION','EXECUTION','RUNTIME','FABRIC','DISTRIBUTED_MISSION','INTELLIGENCE','GIT','SYSTEM',
]);
export type GraphSourceKind = z.infer<typeof GraphSourceKindSchema>;

export const GraphSourceSchema = z.object({
  kind: GraphSourceKindSchema,
  sourceId: z.string().min(1),
});
export type GraphSource = z.infer<typeof GraphSourceSchema>;

export const GraphNodeSchema = z.object({
  id: z.string().min(1),
  type: GraphNodeTypeSchema,
  missionId: z.string().min(1),
  version: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  source: GraphSourceSchema,
  attributes: z.record(z.unknown()).default({}),
});
export type GraphNode = z.infer<typeof GraphNodeSchema>;

export const GraphEdgeSchema = z.object({
  id: z.string().min(1),
  type: GraphEdgeTypeSchema,
  from: z.string().min(1),
  to: z.string().min(1),
  missionId: z.string().min(1),
  version: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  source: GraphSourceSchema,
  attributes: z.record(z.unknown()).default({}),
});
export type GraphEdge = z.infer<typeof GraphEdgeSchema>;

export const GraphEventSchema = z.object({
  eventId: z.string().min(1),
  missionId: z.string().min(1),
  sequence: z.number().int().nonnegative(),
  version: z.number().int().nonnegative(),
  type: z.string().min(1),
  timestamp: z.string().datetime(),
  actor: z.string().min(1),
  mutationId: z.string().optional(),
  payload: z.record(z.unknown()).default({}),
  previousEventHash: z.string().optional(),
  hash: z.string().min(1),
});
export type GraphEvent = z.infer<typeof GraphEventSchema>;

export const GraphSnapshotSchema = z.object({
  missionId: z.string().min(1),
  version: z.number().int().nonnegative(),
  nodes: z.array(GraphNodeSchema),
  edges: z.array(GraphEdgeSchema),
  stateHash: z.string().min(1),
  createdAt: z.string().datetime(),
});
export type GraphSnapshot = z.infer<typeof GraphSnapshotSchema>;

export const GraphMutationTypeSchema = z.enum(['ADD_NODE','UPDATE_NODE','ADD_EDGE','UPDATE_EDGE','REMOVE_EDGE']);
export type GraphMutationType = z.infer<typeof GraphMutationTypeSchema>;

export const GraphMutationSchema = z.object({
  mutationId: z.string().min(1),
  missionId: z.string().min(1),
  baseVersion: z.number().int().nonnegative(),
  type: GraphMutationTypeSchema,
  actor: z.object({ kind: z.enum(['SYSTEM','JEV','LAYA','USER']), id: z.string().min(1) }),
  targetIds: z.array(z.string()),
  payload: z.record(z.unknown()).default({}),
  reason: z.string().optional(),
  createdAt: z.string().datetime(),
});
export type GraphMutation = z.infer<typeof GraphMutationSchema>;

export interface GraphHealth {
  consistent: boolean;
  nodeCount: number;
  edgeCount: number;
  orphanNodes: number;
  orphanEdges: number;
  invalidReferences: number;
  version: number;
  stateHash: string;
}

export interface GraphDiff {
  fromVersion: number;
  toVersion: number;
  addedNodes: string[];
  removedNodes: string[];
  changedNodes: string[];
  addedEdges: string[];
  removedEdges: string[];
}
