import { nanoid } from 'nanoid';
import type { ExecutionNode, GraphNodeStatus } from '../types/ui';

interface StoreState {
  tree: ExecutionNode | null;
  currentNodeId: string | null;
  isRunning: boolean;
  attempt: number;
  maxAttempts: number;
  setTree: (tree: ExecutionNode) => void;
  updateNode: (nodeId: string, updates: Partial<ExecutionNode>) => void;
  addNode: (parentId: string | null, node: ExecutionNode) => void;
  setCurrentNode: (nodeId: string | null) => void;
  setRunning: (running: boolean) => void;
  incrementAttempt: () => void;
  resetExecution: () => void;
}

let storeRef: (() => StoreState) | null = null;

export function registerStore(getStore: () => StoreState): void {
  storeRef = getStore;
}

function getStore(): StoreState {
  if (!storeRef) {
    throw new Error('Store not registered');
  }
  return storeRef();
}

export class UIController {
  private static instance: UIController;

  static getInstance(): UIController {
    if (!UIController.instance) {
      UIController.instance = new UIController();
    }
    return UIController.instance;
  }

  startExecution(goal: string): ExecutionNode {
    const now = Date.now();
    const root: ExecutionNode = {
      id: nanoid(),
      label: goal,
      status: 'running',
      children: [],
      timestamp: now,
    };

    const store = getStore();
    store.setTree(root);
    store.setRunning(true);
    store.setCurrentNode(root.id);
    
    return root;
  }

  addNode(parentId: string | null, label: string, status: GraphNodeStatus = 'pending'): ExecutionNode {
    const node: ExecutionNode = {
      id: nanoid(),
      label,
      status,
      children: [],
      timestamp: Date.now(),
    };

    const store = getStore();
    store.addNode(parentId, node);
    store.setCurrentNode(node.id);
    
    return node;
  }

  updateNode(nodeId: string, updates: Partial<ExecutionNode>): void {
    const store = getStore();
    store.updateNode(nodeId, updates);
  }

  completeNode(nodeId: string, status: 'done' | 'failed', reason?: string): void {
    this.updateNode(nodeId, {
      status,
      reason,
      updatedAt: Date.now(),
    });
  }

  addRetryNode(parentId: string, attempt: number): ExecutionNode {
    return this.addNode(parentId, `Retry (Attempt ${attempt})`, 'running');
  }

  setNodeStatus(nodeId: string, status: GraphNodeStatus): void {
    this.updateNode(nodeId, { status, updatedAt: Date.now() });
  }

  setNodeMetadata(nodeId: string, metadata: ExecutionNode['metadata']): void {
    const store = getStore();
    const tree = store.tree;
    if (tree) {
      const findNode = (node: ExecutionNode): ExecutionNode | null => {
        if (node.id === nodeId) return node;
        for (const child of node.children) {
          const found = findNode(child);
          if (found) return found;
        }
        return null;
      };
      const node = findNode(tree);
      if (node) {
        this.updateNode(nodeId, { metadata: { ...node.metadata, ...metadata } });
      }
    }
  }

  setNodeQuestion(nodeId: string, question: ExecutionNode['question']): void {
    this.updateNode(nodeId, { 
      question, 
      blocked: question ? true : false,
      status: question ? 'blocked' as GraphNodeStatus : undefined,
    });
  }

  reset(): void {
    const store = getStore();
    store.resetExecution();
  }

  getCurrentTree(): ExecutionNode | null {
    return getStore().tree;
  }

  getCurrentNodeId(): string | null {
    return getStore().currentNodeId;
  }

  isRunning(): boolean {
    return getStore().isRunning;
  }

  incrementAttempt(): void {
    const store = getStore();
    store.incrementAttempt();
  }

  getAttempt(): number {
    return getStore().attempt;
  }
}

export const uiController = UIController.getInstance();
