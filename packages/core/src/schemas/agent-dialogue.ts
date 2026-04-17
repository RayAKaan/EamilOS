import { z } from 'zod';

export const AgentQuestionSchema = z.object({
  id: z.string(),
  type: z.enum(['choice', 'text', 'confirm']),
  question: z.string(),
  options: z.array(z.string()).optional(),
  default: z.string().optional(),
  required: z.boolean(),
  timeout: z.number().optional(),
  context: z.string().optional(),
  nodeId: z.string().optional(),
});

export const AgentAnswerSchema = z.object({
  questionId: z.string(),
  answer: z.string(),
  timestamp: z.number(),
});

export type AgentQuestion = z.infer<typeof AgentQuestionSchema>;
export type AgentAnswer = z.infer<typeof AgentAnswerSchema>;

export interface AgentQuestionEvent {
  question: AgentQuestion;
  nodeId: string;
}

export interface AgentAnswerEvent {
  questionId: string;
  answer: string;
  timestamp: number;
}
