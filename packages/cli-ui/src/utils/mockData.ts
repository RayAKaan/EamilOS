import type { ExecutionNode } from '../types/ui';

export const createMockExecutionTree = (): ExecutionNode => {
  const now = Date.now();
  
  return {
    id: 'root-1',
    label: 'Build REST API with auth',
    status: 'running',
    timestamp: now,
    children: [
      {
        id: 'node-1',
        label: 'Parse requirements',
        status: 'done',
        timestamp: now - 5000,
        children: [],
      },
      {
        id: 'node-2',
        label: 'Validate structure',
        status: 'done',
        timestamp: now - 3000,
        children: [
          {
            id: 'node-2-1',
            label: 'Check dependencies',
            status: 'done',
            timestamp: now - 2500,
            children: [],
          },
        ],
      },
      {
        id: 'node-3',
        label: 'Generate code',
        status: 'failed',
        timestamp: now - 1000,
        reason: 'Missing authentication config',
        children: [
          {
            id: 'node-3-1',
            label: 'Retry with stricter prompt',
            status: 'running',
            timestamp: now - 500,
            metadata: { attempt: 2, model: 'qwen2.5-coder:7b' },
            children: [],
          },
          {
            id: 'node-3-2',
            label: 'Fallback: Split task',
            status: 'pending',
            timestamp: now,
            children: [],
          },
        ],
      },
      {
        id: 'node-4',
        label: 'Write files',
        status: 'pending',
        timestamp: now,
        children: [],
      },
    ],
  };
};

export const createMockBlockedTree = (): ExecutionNode => {
  const base = createMockExecutionTree();
  
  const blockedNode: ExecutionNode = {
    id: 'node-5',
    label: 'Clarify API style',
    status: 'blocked',
    timestamp: Date.now(),
    question: {
      id: 'q-1',
      type: 'choice',
      question: 'Prefer REST or GraphQL?',
      options: ['REST', 'GraphQL', 'Let AI decide'],
      required: true,
      nodeId: 'node-5',
    },
    blocked: true,
    children: [
      {
        id: 'node-5-1',
        label: 'Waiting for user input...',
        status: 'pending',
        timestamp: Date.now(),
        children: [],
      },
    ],
  };
  
  return {
    ...base,
    children: [...base.children, blockedNode],
  };
};

export const createDeepMockTree = (): ExecutionNode => {
  const now = Date.now();
  
  const generateDeepNode = (id: string, depth: number): ExecutionNode => ({
    id,
    label: `Level ${depth} task`,
    status: depth % 2 === 0 ? 'done' : 'running',
    timestamp: now - depth * 1000,
    children: depth < 5 
      ? [generateDeepNode(`${id}-child`, depth + 1)]
      : [],
  });

  return generateDeepNode('deep-root', 0);
};
