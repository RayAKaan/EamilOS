import { FailureType } from './stateful-types.js';
import type { DecisionStatus, DecisionSource } from './decision-types.js';

export type NodeType = 'stage' | 'decision' | 'agent' | 'system';
export type NodeStatus = 'pending' | 'running' | 'success' | 'failed';

export interface NodeMetadata {
  model?: string;
  attempt?: number;
  durationMs?: number;
  strategyUsed?: string;
  stageName?: string;
  extractionStrategy?: string;
  codeDensity?: number;
  placeholderCount?: number;
  fileCount?: number;
  bytesWritten?: number;
  [key: string]: unknown;
}

export interface NodeError {
  code: string;
  message: string;
  failureType?: FailureType;
  retryable?: boolean;
  context?: string;
  filePath?: string;
}

export interface DecisionMetadata {
  question: string;
  options: string[];
  recommended?: string;
  selected?: string;
  status: DecisionStatus;
  source?: DecisionSource;
}

export interface ExecutionNode {
  id: string;
  sessionId: string;
  parentId: string | null;
  childIds: string[];
  label: string;
  type: NodeType;
  status: NodeStatus;
  metadata: NodeMetadata;
  error?: NodeError;
  decision?: DecisionMetadata;
  timestamp: number;
  updatedAt: number;
}

export interface ExecutionGraph {
  rootId: string;
  nodes: Record<string, ExecutionNode>;
  activeNodeId: string | null;
}

export type GraphEvent =
  | { type: 'NODE_CREATED'; node: ExecutionNode }
  | { type: 'NODE_STATUS_CHANGED'; nodeId: string; status: NodeStatus; error?: NodeError; updatedAt: number }
  | { type: 'NODE_CHILD_ADDED'; parentId: string; childId: string }
  | { type: 'DECISION_REQUIRED'; nodeId: string; question: string; options: string[]; status: DecisionStatus }
  | { type: 'DECISION_MADE'; nodeId: string; selected: string; source: DecisionSource }
  | { type: 'DECISION_TIMEOUT'; nodeId: string; fallback: string };

export interface FailurePath {
  failedNode: ExecutionNode;
  ancestors: ExecutionNode[];
  retryBranches: ExecutionNode[][];
}

export interface DecisionPoint {
  node: ExecutionNode;
  strategy: string;
  outcome: NodeStatus;
  branch: ExecutionNode[];
}

export interface GraphStats {
  totalNodes: number;
  totalEdges: number;
  depth: number;
  failedNodes: number;
  successfulNodes: number;
  pendingNodes: number;
  runningNodes: number;
}

export interface RootCauseAnalysis {
  failurePath: FailurePath;
  primaryCause: NodeError;
  contributingFactors: ExecutionNode[];
  suggestedFix: string;
}

export function createGraphNode(params: {
  id: string;
  sessionId: string;
  parentId: string | null;
  label: string;
  type: NodeType;
  status?: NodeStatus;
  metadata?: NodeMetadata;
  decision?: DecisionMetadata;
}): ExecutionNode {
  const now = Date.now();
  return {
    id: params.id,
    sessionId: params.sessionId,
    parentId: params.parentId,
    childIds: [],
    label: params.label,
    type: params.type,
    status: params.status || 'pending',
    metadata: params.metadata || {},
    decision: params.decision,
    timestamp: now,
    updatedAt: now,
  };
}

export function createRootNode(sessionId: string, goal: string): ExecutionNode {
  const { nanoid } = require('nanoid');
  return createGraphNode({
    id: nanoid(),
    sessionId,
    parentId: null,
    label: `Execution: ${goal.substring(0, 50)}${goal.length > 50 ? '...' : ''}`,
    type: 'system',
    status: 'running',
    metadata: { goal },
  });
}

export function isTerminalStatus(status: NodeStatus): boolean {
  return status === 'success' || status === 'failed';
}

export function isActiveStatus(status: NodeStatus): boolean {
  return status === 'pending' || status === 'running';
}

export function getNodeDepth(graph: ExecutionGraph, nodeId: string): number {
  let depth = 0;
  let currentId: string | null = nodeId;

  while (currentId) {
    const currentNode: ExecutionNode | undefined = graph.nodes[currentId];
    if (!currentNode || !currentNode.parentId) break;
    currentId = currentNode.parentId;
    depth++;
  }

  return depth;
}

export function getGraphDepth(graph: ExecutionGraph): number {
  let maxDepth = 0;

  for (const nodeId of Object.keys(graph.nodes)) {
    const depth = getNodeDepth(graph, nodeId);
    maxDepth = Math.max(maxDepth, depth);
  }

  return maxDepth;
}
