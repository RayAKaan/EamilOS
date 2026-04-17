import {
  ExecutionGraph,
  ExecutionNode,
  GraphEvent,
  NodeStatus,
  NodeError,
  NodeMetadata,
  createGraphNode,
  GraphStats,
  getGraphDepth,
} from './graph-types.js';
import { TaskDAG, AgentTask, OrchestrationEvent } from './multi-agent-types.js';
import { ClassifiedError } from './stateful-types.js';

function generateNodeId(): string {
  return `node_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

export class MultiAgentGraphIntegrator {
  private graph: ExecutionGraph;
  private listeners: Array<(event: GraphEvent) => void> = [];
  private dagNodeMap: Map<string, string> = new Map();

  constructor(sessionId: string, rootGoal: string) {
    const rootNode = createGraphNode({
      id: generateNodeId(),
      sessionId,
      parentId: null,
      label: `DAG: ${rootGoal.substring(0, 50)}${rootGoal.length > 50 ? '...' : ''}`,
      type: 'system',
      status: 'pending',
      metadata: { rootGoal, isDAG: true },
    });

    this.graph = {
      rootId: rootNode.id,
      nodes: { [rootNode.id]: rootNode },
      activeNodeId: rootNode.id,
    };

    this.dagNodeMap.set('root', rootNode.id);
  }

  initializeDAG(dag: TaskDAG): void {
    const dagNode = createGraphNode({
      id: dag.id,
      sessionId: dag.sessionId,
      parentId: this.graph.rootId,
      label: `TaskDAG: ${dag.rootGoal.substring(0, 40)}${dag.rootGoal.length > 40 ? '...' : ''}`,
      type: 'system',
      status: 'running',
      metadata: {
        rootGoal: dag.rootGoal,
        taskCount: Object.keys(dag.tasks).length,
        isDAG: true,
      },
    });

    this.graph.nodes[dagNode.id] = dagNode;
    this.graph.nodes[this.graph.rootId].childIds.push(dagNode.id);
    this.dagNodeMap.set(dag.id, dagNode.id);

    this.emit({ type: 'NODE_CREATED', node: dagNode });
    this.emit({ type: 'NODE_CHILD_ADDED', parentId: this.graph.rootId, childId: dagNode.id });

    for (const task of Object.values(dag.tasks)) {
      this.createTaskNode(dag.id, task);
    }
  }

  createTaskNode(dagId: string, task: AgentTask): ExecutionNode {
    const parentDagNodeId = this.dagNodeMap.get(dagId);
    const parentId = parentDagNodeId || this.graph.rootId;

    const taskNode = createGraphNode({
      id: task.id,
      sessionId: '',
      parentId,
      label: `[${task.role.toUpperCase()}] ${task.goal.substring(0, 40)}${task.goal.length > 40 ? '...' : ''}`,
      type: 'agent',
      status: 'pending',
      metadata: {
        role: task.role,
        provider: task.assignedProvider,
        contextKey: task.outputContextKey,
        dependsOn: task.dependsOn,
      },
    });

    this.graph.nodes[taskNode.id] = taskNode;
    this.graph.nodes[parentId].childIds.push(taskNode.id);
    this.dagNodeMap.set(task.id, taskNode.id);

    this.emit({ type: 'NODE_CREATED', node: taskNode });
    this.emit({ type: 'NODE_CHILD_ADDED', parentId, childId: taskNode.id });

    return taskNode;
  }

  updateTaskStatus(taskId: string, status: NodeStatus, error?: ClassifiedError, metadata?: Partial<NodeMetadata>): void {
    const nodeId = this.dagNodeMap.get(taskId);
    if (!nodeId) return;

    const node = this.graph.nodes[nodeId];
    if (!node) return;

    node.status = status;
    node.updatedAt = Date.now();

    if (metadata) {
      node.metadata = { ...node.metadata, ...metadata };
    }

    if (error) {
      node.error = {
        code: error.code,
        message: error.message,
        failureType: error.failureType,
        retryable: error.retryable,
        context: error.context,
      };
    }

    if (status === 'success' || status === 'failed') {
      this.emitStatusChange(nodeId, status, node.error);
    }
  }

  handleOrchestrationEvent(event: OrchestrationEvent): void {
    switch (event.type) {
      case 'DAG_CREATED':
        this.initializeDAG(event.dag);
        break;

      case 'TASK_STARTED':
        this.updateTaskStatus(event.taskId, 'running', undefined, {
          provider: event.provider,
          startedAt: Date.now(),
        });
        break;

      case 'TASK_COMPLETED':
        this.updateTaskStatus(event.taskId, 'success', undefined, {
          completedAt: Date.now(),
        });
        break;

      case 'TASK_FAILED':
        this.updateTaskStatus(event.taskId, 'failed', event.error);
        break;

      case 'TASK_CANCELLED':
        this.updateTaskStatus(event.taskId, 'failed', {
          code: 'SYNTAX_ERROR' as never,
          message: event.reason,
          context: event.taskId,
          stage: 'content' as never,
          failureType: 'content_error',
          retryable: false,
          suggestedStrategy: 'abort',
        });
        break;

      case 'DAG_COMPLETED':
        this.finalizeDAG(event.dagId, event.finalContextVersion);
        break;

      case 'DAG_FAILED':
        this.finalizeDAG(event.dagId, 0, event.reason);
        break;

      case 'CONTEXT_MERGED':
        break;

      case 'CONTEXT_CONFLICT':
        break;
    }
  }

  private finalizeDAG(dagId: string, finalContextVersion: number, reason?: string): void {
    const dagNodeId = this.dagNodeMap.get(dagId);
    if (!dagNodeId) return;

    const dagNode = this.graph.nodes[dagNodeId];
    if (!dagNode) return;

    const allTasks = Object.values(this.graph.nodes).filter(
      n => n.parentId === dagNodeId
    );

    const hasFailed = allTasks.some(n => n.status === 'failed');
    const allSucceeded = allTasks.every(n => n.status === 'success');

    dagNode.status = hasFailed && !allSucceeded ? 'failed' : allSucceeded ? 'success' : 'running';
    dagNode.updatedAt = Date.now();
    dagNode.metadata = {
      ...dagNode.metadata,
      finalContextVersion,
      reason,
      completedAt: Date.now(),
    };

    this.emitStatusChange(dagNodeId, dagNode.status);

    const rootNode = this.graph.nodes[this.graph.rootId];
    if (rootNode) {
      rootNode.status = dagNode.status;
      rootNode.updatedAt = Date.now();
      this.emitStatusChange(this.graph.rootId, rootNode.status);
    }
  }

  createParallelBranch(parentTaskId: string, childTaskIds: string[]): void {
    const parentNodeId = this.dagNodeMap.get(parentTaskId);
    if (!parentNodeId) return;

    for (const childTaskId of childTaskIds) {
      const childNodeId = this.dagNodeMap.get(childTaskId);
      if (childNodeId) {
        const parentNode = this.graph.nodes[parentNodeId];
        const childNode = this.graph.nodes[childNodeId];

        if (parentNode && childNode) {
          this.emit({ type: 'NODE_CHILD_ADDED', parentId: parentNodeId, childId: childNodeId });
        }
      }
    }
  }

  getGraph(): ExecutionGraph {
    return this.graph;
  }

  getStats(): GraphStats {
    const nodes = Object.values(this.graph.nodes);
    const edges = nodes.reduce((sum, n) => sum + n.childIds.length, 0);

    return {
      totalNodes: nodes.length,
      totalEdges: edges,
      depth: getGraphDepth(this.graph),
      failedNodes: nodes.filter(n => n.status === 'failed').length,
      successfulNodes: nodes.filter(n => n.status === 'success').length,
      pendingNodes: nodes.filter(n => n.status === 'pending').length,
      runningNodes: nodes.filter(n => n.status === 'running').length,
    };
  }

  getNode(nodeId: string): ExecutionNode | undefined {
    return this.graph.nodes[nodeId];
  }

  getTaskNode(taskId: string): ExecutionNode | undefined {
    const nodeId = this.dagNodeMap.get(taskId);
    return nodeId ? this.graph.nodes[nodeId] : undefined;
  }

  private emitStatusChange(nodeId: string, status: NodeStatus, error?: NodeError): void {
    this.emit({
      type: 'NODE_STATUS_CHANGED',
      nodeId,
      status,
      error,
      updatedAt: Date.now(),
    });
  }

  subscribe(listener: (event: GraphEvent) => void): () => void {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index > -1) this.listeners.splice(index, 1);
    };
  }

  private emit(event: GraphEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('Graph integrator listener error:', error);
      }
    }
  }
}

export function createMultiAgentGraphIntegrator(sessionId: string, rootGoal: string): MultiAgentGraphIntegrator {
  return new MultiAgentGraphIntegrator(sessionId, rootGoal);
}
