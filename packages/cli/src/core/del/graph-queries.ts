import {
  ExecutionGraph,
  ExecutionNode,
  FailurePath,
  DecisionPoint,
  GraphStats,
  RootCauseAnalysis,
  getNodeDepth,
} from './graph-types.js';

export function getFailurePaths(graph: ExecutionGraph): FailurePath[] {
  const failures: FailurePath[] = [];

  for (const node of Object.values(graph.nodes)) {
    if (node.status === 'failed') {
      const ancestors = getAncestorPath(graph, node.id);
      const retryBranches = getRetryBranches(graph, node.id);

      failures.push({
        failedNode: node,
        ancestors,
        retryBranches,
      });
    }
  }

  return failures;
}

export function getAncestorPath(graph: ExecutionGraph, nodeId: string): ExecutionNode[] {
  const path: ExecutionNode[] = [];
  let currentId: string | null = nodeId;

  while (currentId) {
    const node: ExecutionNode | undefined = graph.nodes[currentId];
    if (!node) break;
    path.unshift(node);
    currentId = node.parentId;
  }

  return path;
}

export function getRetryBranches(graph: ExecutionGraph, failedNodeId: string): ExecutionNode[][] {
  const branches: ExecutionNode[][] = [];

  const failedNode: ExecutionNode | undefined = graph.nodes[failedNodeId];
  if (!failedNode) return branches;

  for (const childId of failedNode.childIds) {
    const branch = collectBranch(graph, childId);
    if (branch.length > 0) {
      branches.push(branch);
    }
  }

  return branches;
}

function collectBranch(graph: ExecutionGraph, startNodeId: string): ExecutionNode[] {
  const branch: ExecutionNode[] = [];
  let currentId: string | null = startNodeId;

  while (currentId) {
    const node: ExecutionNode | undefined = graph.nodes[currentId];
    if (!node) break;
    branch.push(node);

    if (node.childIds.length === 0) break;

    const lastChildId: string = node.childIds[node.childIds.length - 1];
    currentId = lastChildId;
  }

  return branch;
}

export function getDecisionPoints(graph: ExecutionGraph): DecisionPoint[] {
  const decisions: DecisionPoint[] = [];

  for (const node of Object.values(graph.nodes)) {
    if (node.type === 'decision') {
      const branch = collectBranch(graph, node.id);

      decisions.push({
        node,
        strategy: node.metadata.strategyUsed || 'unknown',
        outcome: node.status,
        branch,
      });
    }
  }

  return decisions;
}

export function getPrimaryFailure(graph: ExecutionGraph): FailurePath | null {
  const failures = getFailurePaths(graph);
  if (failures.length === 0) return null;

  failures.sort((a, b) => {
    const aDepth = getNodeDepth(graph, a.failedNode.id);
    const bDepth = getNodeDepth(graph, b.failedNode.id);
    return bDepth - aDepth;
  });

  return failures[0];
}

export function analyzeRootCause(graph: ExecutionGraph): RootCauseAnalysis | null {
  const primaryFailure = getPrimaryFailure(graph);
  if (!primaryFailure) return null;

  const contributingFactors: ExecutionNode[] = [];

  for (const ancestor of primaryFailure.ancestors) {
    if (ancestor.status === 'failed') {
      contributingFactors.push(ancestor);
    }
  }

  const primaryCause = primaryFailure.failedNode.error || {
    code: 'UNKNOWN',
    message: 'Unknown error',
  };

  const suggestedFix = generateSuggestedFix(primaryFailure.failedNode);

  return {
    failurePath: primaryFailure,
    primaryCause,
    contributingFactors: contributingFactors.slice(1),
    suggestedFix,
  };
}

function generateSuggestedFix(failedNode: ExecutionNode): string {
  const errorCode = failedNode.error?.code || '';

  switch (errorCode) {
    case 'EXTRACTION_FAILURE':
      return 'The model output could not be parsed. Try using a markdown code block or ensure the JSON is properly formatted.';

    case 'SCHEMA_MISMATCH':
      return 'The JSON structure does not match expected schema. Ensure {"files": [{"path": string, "content": string}]} format.';

    case 'PLACEHOLDER_DETECTED':
      return 'Code contains TODO/FIXME/placeholder text. Replace with actual implementation.';

    case 'LOW_CODE_DENSITY':
      return 'Content has too few code lines. Ensure >40% is actual code, not comments or blank lines.';

    case 'SYNTAX_ERROR':
      return 'Code has syntax errors. Fix syntax errors for the file type.';

    case 'PATH_TRAVERSAL':
      return 'Path contains ".." or absolute path. Use relative paths only.';

    case 'SECRET_DETECTED':
      return 'API key or secret detected in content. Remove or mask sensitive data.';

    default:
      if (failedNode.type === 'stage') {
        return `Stage "${failedNode.label}" failed. Review the error and retry with corrected input.`;
      }
      return 'An unexpected error occurred. Check the error details and retry.';
  }
}

export function getGraphStats(graph: ExecutionGraph): GraphStats {
  const nodes = Object.values(graph.nodes);

  let maxDepth = 0;
  for (const node of nodes) {
    const depth = getNodeDepth(graph, node.id);
    maxDepth = Math.max(maxDepth, depth);
  }

  return {
    totalNodes: nodes.length,
    totalEdges: nodes.reduce((sum, n) => sum + n.childIds.length, 0),
    depth: maxDepth,
    failedNodes: nodes.filter(n => n.status === 'failed').length,
    successfulNodes: nodes.filter(n => n.status === 'success').length,
    pendingNodes: nodes.filter(n => n.status === 'pending').length,
    runningNodes: nodes.filter(n => n.status === 'running').length,
  };
}

export function getNodeTimeline(graph: ExecutionGraph): ExecutionNode[] {
  return Object.values(graph.nodes).sort((a, b) => a.timestamp - b.timestamp);
}

export function getFailedNodesByType(graph: ExecutionGraph): Record<string, ExecutionNode[]> {
  const byType: Record<string, ExecutionNode[]> = {};

  for (const node of Object.values(graph.nodes)) {
    if (node.status === 'failed') {
      const key = node.error?.code || 'UNKNOWN';
      if (!byType[key]) {
        byType[key] = [];
      }
      byType[key].push(node);
    }
  }

  return byType;
}

export function hasUnresolvedFailures(graph: ExecutionGraph): boolean {
  const runningNodes = Object.values(graph.nodes).filter(n => n.status === 'running');
  if (runningNodes.length === 0) return false;

  for (const running of runningNodes) {
    const ancestors = getAncestorPath(graph, running.id);
    const hasFailedAncestor = ancestors.some(a => a.status === 'failed');
    if (hasFailedAncestor) return true;
  }

  return false;
}

export function getRetryCount(graph: ExecutionGraph, originalNodeId: string): number {
  const originalNode: ExecutionNode | undefined = graph.nodes[originalNodeId];
  if (!originalNode) return 0;

  let count = 0;
  for (const child of Object.values(graph.nodes)) {
    const ancestors = getAncestorPath(graph, child.id);
    const hasOriginalAsAncestor = ancestors.some(a => a.id === originalNodeId && a.type === 'decision');
    if (hasOriginalAsAncestor && child.type === 'decision') {
      count++;
    }
  }

  return count;
}

export function serializeGraphSummary(graph: ExecutionGraph): string {
  const stats = getGraphStats(graph);
  const failures = getFailurePaths(graph);
  const decisions = getDecisionPoints(graph);

  const lines: string[] = [
    `Execution Graph Summary`,
    `========================`,
    `Total Nodes: ${stats.totalNodes}`,
    `Depth: ${stats.depth}`,
    `Status: ${stats.successfulNodes} succeeded, ${stats.failedNodes} failed, ${stats.pendingNodes} pending`,
    ``,
  ];

  if (failures.length > 0) {
    lines.push(`Failures (${failures.length}):`);
    for (const failure of failures) {
      lines.push(`  - ${failure.failedNode.label}: ${failure.failedNode.error?.code || 'UNKNOWN'}`);
    }
    lines.push(``);
  }

  if (decisions.length > 0) {
    lines.push(`Decision Points (${decisions.length}):`);
    for (const decision of decisions) {
      lines.push(`  - ${decision.strategy}: ${decision.outcome}`);
    }
  }

  return lines.join('\n');
}
