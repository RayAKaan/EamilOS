import { nanoid } from 'nanoid';
import { getEventBus } from '../event-bus.js';
import type { AgentQuestion, SystemEvent } from '../types.js';

export interface AskUserOptions extends Omit<AgentQuestion, 'id'> {
  nodeId?: string;
}

const pendingQuestions = new Map<string, {
  resolve: (answer: string) => void;
  reject: (error: Error) => void;
  timeoutId?: ReturnType<typeof setTimeout>;
}>();

export async function askUser(options: AskUserOptions): Promise<string> {
  const eventBus = getEventBus();
  const id = nanoid();
  
  return new Promise<string>((resolve, reject) => {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const cleanup = () => {
      eventBus.off('agent.answered', onAnswer as any);
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      pendingQuestions.delete(id);
    };

    const onAnswer = (event: SystemEvent) => {
      const data = event.data as { questionId?: string; answer?: string } | undefined;
      if (data?.questionId === id) {
        cleanup();
        resolve(data.answer ?? '');
      }
    };

    eventBus.on('agent.answered', onAnswer as any);

    const fullQuestion: AgentQuestion = {
      ...options,
      id,
      nodeId: options.nodeId,
    };

    eventBus.emit({
      type: 'agent.question',
      data: {
        question: fullQuestion,
        nodeId: options.nodeId || 'root',
      },
    });

    if (options.timeout && options.timeout > 0) {
      timeoutId = setTimeout(() => {
        cleanup();
        const fallback = options.default ?? '';
        eventBus.emit({
          type: 'agent.answered',
          data: {
            questionId: id,
            answer: fallback,
            timestamp: Date.now(),
          },
        });
        resolve(fallback);
      }, options.timeout);
    }

    process.once('exit', () => {
      cleanup();
      reject(new Error('Process exited before answer'));
    });
  });
}

export function createQuestion(options: AskUserOptions): AgentQuestion {
  return {
    ...options,
    id: nanoid(),
    nodeId: options.nodeId,
  };
}

export function getPendingQuestion(id: string) {
  return pendingQuestions.get(id);
}

export function hasPendingQuestions(): boolean {
  return pendingQuestions.size > 0;
}
