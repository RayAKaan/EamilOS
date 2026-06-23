import { EventEmitter } from 'events';

export interface KGNode {
  id: string;
  type: 'task' | 'agent' | 'file' | 'concept' | 'code' | 'error' | 'context';
  label: string;
  properties: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  confidence?: number;
  source?: string;
  tags?: string[];
}

export interface KGEdge {
  id: string;
  source: string;
  target: string;
  type: 'depends_on' | 'produced' | 'related_to' | 'refines' | 'validates' | 'contradicts' | 'extends';
  weight: number;
  properties?: Record<string, unknown>;
  createdAt: number;
}

export interface KGQuery {
  nodeType?: KGNode['type'];
  tags?: string[];
  source?: string;
  labelContains?: string;
  propertyFilters?: Record<string, unknown>;
  depth?: number;
  limit?: number;
}

export interface KGSearchResult {
  nodes: KGNode[];
  paths: KGPath[];
  relevance: number;
}

export interface KGPath {
  nodes: KGNode[];
  edges: KGEdge[];
  totalWeight: number;
}

export interface KGContext {
  tasks: KGNode[];
  files: KGNode[];
  concepts: KGNode[];
  recentHistory: KGNode[];
  activeAgent?: string;
  pendingTasks: KGNode[];
}

export class Graphify extends EventEmitter {
  private nodes: Map<string, KGNode> = new Map();
  private edges: Map<string, KGEdge> = new Map();
  private edgeIndex: Map<string, Set<string>> = new Map();
  private nodeIndex: Map<string, Set<string>> = new Map();
  private taskHistory: KGNode[] = [];
  private maxHistorySize = 100;

  createNode(node: Omit<KGNode, 'id' | 'createdAt' | 'updatedAt'>): KGNode {
    const id = `kg_${node.type}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const fullNode: KGNode = {
      ...node,
      id,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.nodes.set(id, fullNode);
    this.emit('node:created', fullNode);
    return fullNode;
  }

  updateNode(id: string, updates: Partial<KGNode>): KGNode | null {
    const existing = this.nodes.get(id);
    if (!existing) return null;

    const updated: KGNode = {
      ...existing,
      ...updates,
      id,
      updatedAt: Date.now(),
    };

    this.nodes.set(id, updated);
    this.emit('node:updated', updated);
    return updated;
  }

  getNode(id: string): KGNode | undefined {
    return this.nodes.get(id);
  }

  deleteNode(id: string): boolean {
    const node = this.nodes.get(id);
    if (!node) return false;

    const connectedEdges = this.edgeIndex.get(id) || new Set();
    for (const edgeId of connectedEdges) {
      this.edges.delete(edgeId);
    }

    this.nodes.delete(id);
    this.edgeIndex.delete(id);
    this.emit('node:deleted', { id, type: node.type });
    return true;
  }

  createEdge(edge: Omit<KGEdge, 'id' | 'createdAt'>): KGEdge {
    const id = `edge_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const fullEdge: KGEdge = {
      ...edge,
      id,
      createdAt: Date.now(),
    };

    this.edges.set(id, fullEdge);

    if (!this.edgeIndex.has(edge.source)) {
      this.edgeIndex.set(edge.source, new Set());
    }
    this.edgeIndex.get(edge.source)!.add(id);

    if (!this.edgeIndex.has(edge.target)) {
      this.edgeIndex.set(edge.target, new Set());
    }
    this.edgeIndex.get(edge.target)!.add(id);

    if (!this.nodeIndex.has(id)) {
      this.nodeIndex.set(id, new Set());
    }
    this.nodeIndex.get(id)!.add(edge.source);
    this.nodeIndex.get(id)!.add(edge.target);

    this.emit('edge:created', fullEdge);
    return fullEdge;
  }

  getEdgesForNode(nodeId: string): KGEdge[] {
    const edgeIds = this.edgeIndex.get(nodeId) || new Set();
    return [...edgeIds].map(id => this.edges.get(id)!).filter(Boolean);
  }

  getConnectedNodes(nodeId: string, edgeType?: string): KGNode[] {
    const edges = this.getEdgesForNode(nodeId);
    const connectedIds = new Set<string>();

    for (const edge of edges) {
      if (edgeType && edge.type !== edgeType) continue;
      if (edge.source === nodeId) connectedIds.add(edge.target);
      if (edge.target === nodeId) connectedIds.add(edge.source);
    }

    return [...connectedIds].map(id => this.nodes.get(id)!).filter(Boolean);
  }

  createTask(description: string, priority: 'low' | 'normal' | 'high' | 'urgent' = 'normal'): KGNode {
    const taskNode = this.createNode({
      type: 'task',
      label: description,
      properties: { priority, status: 'pending', assignedAgent: null, attempts: 0 },
      tags: ['task'],
      confidence: 1.0,
    });

    this.addToHistory(taskNode);
    return taskNode;
  }

  assignTask(taskId: string, agentId: string): KGNode | null {
    return this.updateNode(taskId, {
      properties: {
        ...this.nodes.get(taskId)?.properties,
        assignedAgent: agentId,
        status: 'in_progress',
      },
    });
  }

  completeTask(taskId: string, result: string): KGNode | null {
    return this.updateNode(taskId, {
      properties: {
        ...this.nodes.get(taskId)?.properties,
        status: 'completed',
        result,
      },
      confidence: 1.0,
    });
  }

  recordAgentAction(agentId: string, action: string, result: string, context: Record<string, unknown> = {}): KGNode {
    const node = this.createNode({
      type: 'context',
      label: `${agentId}: ${action}`,
      properties: { agentId, action, result, ...context },
      source: agentId,
      tags: ['agent-action', agentId],
      confidence: 0.8,
    });

    this.addToHistory(node);

    const agentNode = this.nodes.get(`agent_${agentId}`);
    if (agentNode) {
      this.createEdge({
        source: agentNode.id,
        target: node.id,
        type: 'produced',
        weight: 0.9,
      });
    }

    return node;
  }

  createAgentNode(agentId: string, name: string, capabilities: string[]): KGNode {
    const existing = [...this.nodes.values()].find(n => n.type === 'agent' && n.label === name);
    if (existing) return existing;

    return this.createNode({
      type: 'agent',
      label: name,
      properties: { capabilities, status: 'idle' },
      source: 'eamilos',
      tags: ['agent', agentId],
      confidence: 1.0,
    });
  }

  trackFile(path: string, content: string, agentId: string, action: 'created' | 'modified' | 'deleted'): KGNode {
    const hash = this.hashContent(content);
    const existing = [...this.nodes.values()].find(
      n => n.type === 'file' && n.properties.path === path
    );

    if (existing) {
      const updated = this.updateNode(existing.id, {
        properties: {
          ...existing.properties,
          contentHash: hash,
          lastModifiedBy: agentId,
          lastAction: action,
          version: (existing.properties.version as number || 0) + 1,
        },
      });

      this.createEdge({
        source: updated!.id,
        target: this.findNodeByLabel(agentId)?.id || '',
        type: 'produced',
        weight: 1.0,
      });

      return updated!;
    }

    const fileNode = this.createNode({
      type: 'file',
      label: path.split('/').pop() || path,
      properties: {
        path,
        contentHash: hash,
        createdBy: agentId,
        lastModifiedBy: agentId,
        lastAction: action,
        version: 1,
        language: this.detectLanguage(path),
      },
      source: agentId,
      tags: ['file', this.detectLanguage(path)],
      confidence: 1.0,
    });

    const agentNode = [...this.nodes.values()].find(n => n.type === 'agent' && n.label === agentId);
    if (agentNode) {
      this.createEdge({
        source: agentNode.id,
        target: fileNode.id,
        type: 'produced',
        weight: 1.0,
      });
    }

    return fileNode;
  }

  recordConcept(concept: string, agentId: string, description: string): KGNode {
    const node = this.createNode({
      type: 'concept',
      label: concept,
      properties: { description, source: agentId },
      source: agentId,
      tags: ['concept', 'knowledge'],
      confidence: 0.7,
    });

    this.addToHistory(node);
    return node;
  }

  recordValidation(nodeId: string, validator: string, result: 'passed' | 'failed' | 'repaired', details: string): KGNode {
    const validationNode = this.createNode({
      type: 'concept',
      label: `Validation: ${result}`,
      properties: { targetNodeId: nodeId, validator, result, details },
      source: 'eamilos',
      tags: ['validation', result],
      confidence: 1.0,
    });

    this.createEdge({
      source: validationNode.id,
      target: nodeId,
      type: 'validates',
      weight: result === 'passed' ? 1.0 : 0.2,
    });

    return validationNode;
  }

  recordError(error: string, source: string, context: Record<string, unknown> = {}): KGNode {
    const errorNode = this.createNode({
      type: 'error',
      label: error.slice(0, 100),
      properties: { error, source, ...context },
      source: 'eamilos',
      tags: ['error'],
      confidence: 1.0,
    });

    this.addToHistory(errorNode);
    return errorNode;
  }

  getContextSummary(forAgent: string, maxNodes = 20): KGContext {
    const tasks = [...this.nodes.values()].filter(n => n.type === 'task');
    const pendingTasks = tasks.filter(t => t.properties.status !== 'completed');
    const files = [...this.nodes.values()].filter(n => n.type === 'file');
    const concepts = [...this.nodes.values()].filter(n => n.type === 'concept' && (n.tags?.includes(forAgent) || n.source === forAgent));
    const recentHistory = this.taskHistory.slice(-maxNodes);
    const activeTask = pendingTasks.find(t => t.properties.assignedAgent === forAgent);

    return {
      tasks: pendingTasks.slice(0, 10),
      files: files.slice(-10),
      concepts: concepts.slice(-5),
      recentHistory,
      activeAgent: forAgent,
      pendingTasks: pendingTasks.slice(0, 5),
    };
  }

  buildContextString(forAgent: string): string {
    const ctx = this.getContextSummary(forAgent);
    let output = '## Knowledge Graph Context\n\n';

    if (ctx.pendingTasks.length > 0) {
      output += '### Active Tasks\n';
      for (const task of ctx.pendingTasks) {
        output += `- ${task.label} [${task.properties.priority}] ${task.properties.assignedAgent ? `(assigned to ${task.properties.assignedAgent})` : '(unassigned)'}\n`;
      }
      output += '\n';
    }

    if (ctx.files.length > 0) {
      output += '### Files in Context\n';
      for (const file of ctx.files) {
        output += `- ${file.properties.path} (last modified by ${file.properties.lastModifiedBy})\n`;
      }
      output += '\n';
    }

    if (ctx.recentHistory.length > 0) {
      output += '### Recent Actions\n';
      for (const action of ctx.recentHistory.slice(-5)) {
        output += `- [${action.type}] ${action.label}\n`;
      }
      output += '\n';
    }

    return output;
  }

  search(query: KGQuery): KGSearchResult {
    let nodes = [...this.nodes.values()];

    if (query.nodeType) {
      nodes = nodes.filter(n => n.type === query.nodeType);
    }

    if (query.tags && query.tags.length > 0) {
      nodes = nodes.filter(n => query.tags!.some(tag => n.tags?.includes(tag)));
    }

    if (query.source) {
      nodes = nodes.filter(n => n.source === query.source);
    }

    if (query.labelContains) {
      nodes = nodes.filter(n => n.label.toLowerCase().includes(query.labelContains!.toLowerCase()));
    }

    if (query.propertyFilters) {
      nodes = nodes.filter(n =>
        Object.entries(query.propertyFilters!).every(([key, value]) => n.properties[key] === value)
      );
    }

    const paths: KGPath[] = [];
    if (query.depth && query.depth > 0) {
      for (const node of nodes.slice(0, 10)) {
        const foundPaths = this.findPathsFromNode(node.id, query.depth);
        paths.push(...foundPaths);
      }
    }

    return {
      nodes: nodes.slice(0, query.limit || 20),
      paths: paths.slice(0, 5),
      relevance: nodes.length / 100,
    };
  }

  private findPathsFromNode(nodeId: string, maxDepth: number): KGPath[] {
    const paths: KGPath[] = [];

    const traverse = (currentId: string, depth: number, pathNodes: KGNode[], pathEdges: KGEdge[]) => {
      if (depth >= maxDepth) return;

      const connected = this.getConnectedNodes(currentId);
      for (const nextNode of connected) {
        const edge = [...this.edges.values()].find(
          e => (e.source === currentId && e.target === nextNode.id) ||
               (e.target === currentId && e.source === nextNode.id)
        );

        if (edge && !pathEdges.find(e => e.id === edge.id)) {
          const newNodes = [...pathNodes, nextNode];
          const newEdges = [...pathEdges, edge];

          paths.push({
            nodes: newNodes,
            edges: newEdges,
            totalWeight: newEdges.reduce((sum, e) => sum + e.weight, 0),
          });

          traverse(nextNode.id, depth + 1, newNodes, newEdges);
        }
      }
    };

    const startNode = this.nodes.get(nodeId);
    if (startNode) {
      traverse(nodeId, 0, [startNode], []);
    }

    return paths;
  }

  private addToHistory(node: KGNode): void {
    this.taskHistory.push(node);
    if (this.taskHistory.length > this.maxHistorySize) {
      this.taskHistory.shift();
    }
  }

  private hashContent(content: string): string {
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString(16);
  }

  private detectLanguage(path: string): string {
    const ext = path.split('.').pop()?.toLowerCase();
    const langMap: Record<string, string> = {
      ts: 'typescript', tsx: 'typescript',
      js: 'javascript', jsx: 'javascript',
      py: 'python', go: 'go', rs: 'rust',
      java: 'java', cpp: 'cpp', cc: 'cpp', cxx: 'cpp',
      c: 'c', rb: 'ruby', php: 'php',
      json: 'json', yaml: 'yaml', yml: 'yaml', md: 'markdown',
    };
    return langMap[ext || ''] || 'unknown';
  }

  private findNodeByLabel(label: string): KGNode | undefined {
    return [...this.nodes.values()].find(n => n.label === label);
  }

  export(): { nodes: KGNode[]; edges: KGEdge[] } {
    return {
      nodes: [...this.nodes.values()],
      edges: [...this.edges.values()],
    };
  }

  getStats(): { totalNodes: number; totalEdges: number; byType: Record<string, number>; bySource: Record<string, number> } {
    const byType: Record<string, number> = {};
    const bySource: Record<string, number> = {};

    for (const node of this.nodes.values()) {
      byType[node.type] = (byType[node.type] || 0) + 1;
      bySource[node.source || 'unknown'] = (bySource[node.source || 'unknown'] || 0) + 1;
    }

    return {
      totalNodes: this.nodes.size,
      totalEdges: this.edges.size,
      byType,
      bySource,
    };
  }

  clear(): void {
    this.nodes.clear();
    this.edges.clear();
    this.edgeIndex.clear();
    this.nodeIndex.clear();
    this.taskHistory = [];
    this.emit('cleared');
  }
}
