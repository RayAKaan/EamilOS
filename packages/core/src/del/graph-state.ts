import { nanoid } from 'nanoid';
import {
  ExecutionGraph,
  ExecutionNode,
  GraphEvent,
  NodeType,
  NodeStatus,
  NodeMetadata,
  NodeError,
  createGraphNode,
  createRootNode,
  getGraphDepth,
  GraphStats,
} from './graph-types.js';

export type GraphEventListener = (event: GraphEvent) => void;

export class GraphStateManager {
  private graph: ExecutionGraph;
  private listeners: Set<GraphEventListener> = new Set();
  private sessionId: string;

  constructor(sessionId: string, goal?: string) {
    this.sessionId = sessionId;

    const rootNode = createRootNode(sessionId, goal || 'Execution');

    this.graph = {
      rootId: rootNode.id,
      nodes: { [rootNode.id]: rootNode },
      activeNodeId: rootNode.id,
    };

    this.emit({ type: 'NODE_CREATED', node: rootNode });
  }

  getGraph(): ExecutionGraph {
    return this.graph;
  }

  getSessionId(): string {
    return this.sessionId;
  }

  getRootNode(): ExecutionNode {
    return this.graph.nodes[this.graph.rootId];
  }

  getActiveNode(): ExecutionNode | null {
    if (!this.graph.activeNodeId) return null;
    return this.graph.nodes[this.graph.activeNodeId];
  }

  getNode(nodeId: string): ExecutionNode | undefined {
    return this.graph.nodes[nodeId];
  }

  getAllNodes(): ExecutionNode[] {
    return Object.values(this.graph.nodes);
  }

  subscribe(listener: GraphEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(event: GraphEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
      }
    }
  }

  createChildNode(params: {
    label: string;
    type: NodeType;
    parentId?: string;
    status?: NodeStatus;
    metadata?: NodeMetadata;
  }): ExecutionNode {
    const parentId = params.parentId || this.graph.activeNodeId || this.graph.rootId;
    const parent = this.graph.nodes[parentId];

    const node = createGraphNode({
      id: nanoid(),
      sessionId: this.sessionId,
      parentId,
      label: params.label,
      type: params.type,
      status: params.status || 'pending',
      metadata: params.metadata,
    });

    this.graph.nodes[node.id] = node;

    if (parent) {
      parent.childIds.push(node.id);
      this.emit({ type: 'NODE_CHILD_ADDED', parentId: parent.id, childId: node.id });
    }

    this.graph.activeNodeId = node.id;
    this.emit({ type: 'NODE_CREATED', node });

    return node;
  }

  updateNodeStatus(
    nodeId: string,
    status: NodeStatus,
    error?: NodeError,
    additionalMetadata?: Partial<NodeMetadata>
  ): ExecutionNode | null {
    const node = this.graph.nodes[nodeId];
    if (!node) return null;

    node.status = status;
    node.updatedAt = Date.now();

    if (error) {
      node.error = error;
    }

    if (additionalMetadata) {
      node.metadata = { ...node.metadata, ...additionalMetadata };
    }

    this.emit({
      type: 'NODE_STATUS_CHANGED',
      nodeId: node.id,
      status,
      error,
      updatedAt: node.updatedAt,
    });

    if (node.parentId) {
      this.graph.activeNodeId = node.parentId;
    }

    return node;
  }

  startNode(nodeId: string, metadata?: NodeMetadata): ExecutionNode | null {
    const node = this.graph.nodes[nodeId];
    if (!node) return null;

    node.status = 'running';
    node.updatedAt = Date.now();

    if (metadata) {
      node.metadata = { ...node.metadata, ...metadata };
    }

    this.graph.activeNodeId = nodeId;
    this.emit({
      type: 'NODE_STATUS_CHANGED',
      nodeId: node.id,
      status: 'running',
      updatedAt: node.updatedAt,
    });

    return node;
  }

  completeNode(nodeId: string, success: boolean, error?: NodeError, durationMs?: number): ExecutionNode | null {
    const node = this.graph.nodes[nodeId];
    if (!node) return null;

    node.status = success ? 'success' : 'failed';
    node.updatedAt = Date.now();

    if (durationMs !== undefined) {
      node.metadata.durationMs = durationMs;
    }

    if (error) {
      node.error = error;
    }

    this.emit({
      type: 'NODE_STATUS_CHANGED',
      nodeId: node.id,
      status: node.status,
      error,
      updatedAt: node.updatedAt,
    });

    if (node.parentId) {
      this.graph.activeNodeId = node.parentId;
    }

    return node;
  }

  createDecisionNode(label: string, metadata?: NodeMetadata): ExecutionNode {
    return this.createChildNode({
      label,
      type: 'decision',
      status: 'running',
      metadata,
    });
  }

  createStageNode(label: string, metadata?: NodeMetadata): ExecutionNode {
    return this.createChildNode({
      label,
      type: 'stage',
      status: 'running',
      metadata,
    });
  }

  createRetryBranch(
    failedNodeId: string,
    attemptNumber: number,
    strategy: string
  ): ExecutionNode {
    const failedNode = this.graph.nodes[failedNodeId];
    if (!failedNode) {
      throw new Error(`Failed node ${failedNodeId} not found`);
    }

    const retryNode = this.createChildNode({
      label: `Retry (${strategy}) - Attempt ${attemptNumber}`,
      type: 'decision',
      parentId: failedNodeId,
      metadata: {
        attempt: attemptNumber,
        strategyUsed: strategy,
        previousFailure: failedNode.error?.code,
      },
    });

    return retryNode;
  }

  getStats(): GraphStats {
    const nodes = Object.values(this.graph.nodes);

    return {
      totalNodes: nodes.length,
      totalEdges: nodes.reduce((sum, n) => sum + n.childIds.length, 0),
      depth: getGraphDepth(this.graph),
      failedNodes: nodes.filter(n => n.status === 'failed').length,
      successfulNodes: nodes.filter(n => n.status === 'success').length,
      pendingNodes: nodes.filter(n => n.status === 'pending').length,
      runningNodes: nodes.filter(n => n.status === 'running').length,
    };
  }

  getNodePath(nodeId: string): ExecutionNode[] {
    const path: ExecutionNode[] = [];
    let currentId: string | null = nodeId;

    while (currentId) {
      const currentNode: ExecutionNode | undefined = this.graph.nodes[currentId];
      if (!currentNode) break;
      path.unshift(currentNode);
      currentId = currentNode.parentId;
    }

    return path;
  }

  finalize(): ExecutionGraph {
    const root = this.graph.nodes[this.graph.rootId];
    if (root && root.status === 'running') {
      root.status = 'success';
      root.updatedAt = Date.now();
    }

    this.graph.activeNodeId = null;

    return this.graph;
  }

  applyEvent(event: GraphEvent): void {
    switch (event.type) {
      case 'NODE_CREATED': {
        const createdNode: ExecutionNode = event.node;
        if (!this.graph.nodes[createdNode.id]) {
          this.graph.nodes[createdNode.id] = createdNode;
          if (createdNode.parentId) {
            const parentNode: ExecutionNode | undefined = this.graph.nodes[createdNode.parentId];
            if (parentNode && !parentNode.childIds.includes(createdNode.id)) {
              parentNode.childIds.push(createdNode.id);
            }
          }
        }
        break;
      }

      case 'NODE_STATUS_CHANGED': {
        const changedNode: ExecutionNode | undefined = this.graph.nodes[event.nodeId];
        if (changedNode) {
          changedNode.status = event.status;
          changedNode.updatedAt = event.updatedAt;
          if (event.error) {
            changedNode.error = event.error;
          }
        }
        break;
      }

      case 'NODE_CHILD_ADDED': {
        const parentNode: ExecutionNode | undefined = this.graph.nodes[event.parentId];
        if (parentNode && !parentNode.childIds.includes(event.childId)) {
          parentNode.childIds.push(event.childId);
        }
        break;
      }
    }
  }

  replayEvents(events: GraphEvent[]): void {
    for (const event of events) {
      this.applyEvent(event);
    }

    let currentNode: ExecutionNode | undefined = this.graph.nodes[this.graph.rootId];
    while (currentNode && currentNode.status === 'running') {
      if (currentNode.childIds.length === 0) break;
      const lastChildId: string = currentNode.childIds[currentNode.childIds.length - 1];
      currentNode = this.graph.nodes[lastChildId];
    }

    this.graph.activeNodeId = currentNode?.id || this.graph.rootId;
  }
}

export function createGraphStateManager(sessionId: string, goal?: string): GraphStateManager {
  return new GraphStateManager(sessionId, goal);
}
