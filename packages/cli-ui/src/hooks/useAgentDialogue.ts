import { useEffect, useCallback, useRef } from 'react';
import { useStore } from '../state/store';

interface AgentQuestionEvent {
  question: {
    id: string;
    type: 'choice' | 'text' | 'confirm';
    question: string;
    options?: string[];
    default?: string;
    required: boolean;
    timeout?: number;
    context?: string;
    nodeId?: string;
  };
  nodeId: string;
}

interface AgentAnswerEvent {
  questionId: string;
  answer: string;
  timestamp: number;
}

export const useAgentDialogue = () => {
  const {
    pendingQuestion,
    setPendingQuestion,
    updateNode,
    tree,
  } = useStore();

  const eventListenersRef = useRef<{
    onQuestion: (data: AgentQuestionEvent) => void;
    onAnswer: (data: AgentAnswerEvent) => void;
  } | null>(null);

  useEffect(() => {
    const onQuestion = (data: AgentQuestionEvent) => {
      const { question, nodeId } = data;
      
      updateNode(nodeId, {
        question,
        blocked: true,
        status: 'blocked',
      });

      setPendingQuestion(question as any);
    };

    const onAnswer = (data: AgentAnswerEvent) => {
      if (!pendingQuestion) return;

      const nodeId = pendingQuestion.nodeId;
      if (nodeId) {
        updateNode(nodeId, {
          question: undefined,
          blocked: false,
          status: 'done',
          reason: `User answered: ${data.answer}`,
        });
      }

      setPendingQuestion(null);
    };

    eventListenersRef.current = { onQuestion, onAnswer };

    try {
      const { getTypedEventBus } = require('../../core/dist/events/TypedEventBus.js');
      const eventBus = getTypedEventBus();
      
      eventBus.on('agent:question', onQuestion as any);
      eventBus.on('agent:answer', onAnswer as any);
    } catch {
      // TypedEventBus not available in this context
    }

    return () => {
      if (eventListenersRef.current) {
        try {
          const { getTypedEventBus } = require('../../core/dist/events/TypedEventBus.js');
          const eventBus = getTypedEventBus();
          eventBus.off('agent:question', eventListenersRef.current.onQuestion as any);
          eventBus.off('agent:answer', eventListenersRef.current.onAnswer as any);
        } catch {
          // Ignore cleanup errors
        }
      }
    };
  }, [updateNode, setPendingQuestion, pendingQuestion]);

  const answerQuestion = useCallback((answer: string) => {
    if (!pendingQuestion) return;

    try {
      const { getTypedEventBus } = require('../../core/dist/events/TypedEventBus.js');
      const eventBus = getTypedEventBus();
      eventBus.emit('agent:answer' as any, {
        questionId: pendingQuestion.id,
        answer,
        timestamp: Date.now(),
      } as any);
    } catch {
      // Fallback: direct store update
    }

    const nodeId = pendingQuestion.nodeId;
    if (nodeId) {
      updateNode(nodeId, {
        question: undefined,
        blocked: false,
        status: 'done',
        reason: `User answered: ${answer}`,
      });
    }

    setPendingQuestion(null);
  }, [pendingQuestion, updateNode, setPendingQuestion]);

  return {
    pendingQuestion,
    answerQuestion,
    hasPendingQuestion: pendingQuestion !== null,
  };
};
