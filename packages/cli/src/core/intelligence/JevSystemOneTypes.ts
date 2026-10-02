import { z } from 'zod';

const ChoiceAnswerSchema = z.object({
  type: z.literal('choice'),
  choice: z.string(),
  probabilities: z.record(z.string(), z.number().min(0).max(1)),
  confidence: z.number().min(0).max(1).optional(),
});
const ScoreAnswerSchema = z.object({
  type: z.literal('score'),
  score: z.number(),
  legend: z.record(z.string(), z.string()).optional(),
  probabilities: z.record(z.string(), z.number().min(0).max(1)),
  confidence: z.number().min(0).max(1).optional(),
});
const NoulAnswerSchema = z.object({
  type: z.literal('noul'),
  noul: z.number().min(0).max(1),
});
export const JevAnswerSchema = z.discriminatedUnion('type', [ChoiceAnswerSchema, ScoreAnswerSchema, NoulAnswerSchema]);
export type JevAnswer = z.infer<typeof JevAnswerSchema>;

export const JevSystemOneResponseSchema = z.object({
  model: z.string().optional(),
  answers: z.record(z.string(), JevAnswerSchema),
  usage: z.object({
    input_tokens: z.number().nonnegative().optional(),
    output_tokens: z.number().nonnegative().optional(),
    total_tokens: z.number().nonnegative().optional(),
    cost: z.number().nonnegative().optional(),
  }).optional(),
  elapsedMs: z.number().nonnegative().optional(),
});
export type JevSystemOneResponse = z.infer<typeof JevSystemOneResponseSchema>;

export interface JevSystemOneRequest {
  model: string;
  state: unknown;
  questions: Record<string, JevQuestion>;
}
export type JevQuestion =
  | { type: 'choice'; instructions: string; criteria: Record<string, string | null> }
  | { type: 'score'; instructions: string; criteria: string[] }
  | { type: 'noul'; instructions: string; criteria?: { true?: string; false?: string } };

export interface JevSystemOneOptions {
  endpoint: string;
  apiKey: string;
  model?: string;
  timeoutMs?: number;
  maxRetries?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  maxTokens?: number;
  maxCostUsd?: number;
  headers?: Record<string, string>;
  healthEndpoint?: string;
}
