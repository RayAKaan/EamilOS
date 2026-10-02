import { z } from 'zod';

export const LayaQuestionTypeSchema = z.enum(['choice', 'score', 'noul']);
export type LayaQuestionType = z.infer<typeof LayaQuestionTypeSchema>;
export const LayaChoiceQuestionSchema = z.object({ type: z.literal('choice'), instructions: z.string().min(1), criteria: z.record(z.string(), z.string().nullable()) });
export const LayaScoreQuestionSchema = z.object({ type: z.literal('score'), instructions: z.string().min(1), criteria: z.array(z.string()).min(2).max(10) });
export const LayaNoulQuestionSchema = z.object({ type: z.literal('noul'), instructions: z.string().min(1), criteria: z.object({ true: z.string().optional(), false: z.string().optional() }).optional() });
export const LayaQuestionSchema = z.discriminatedUnion('type', [LayaChoiceQuestionSchema, LayaScoreQuestionSchema, LayaNoulQuestionSchema]);
export type LayaQuestion = z.infer<typeof LayaQuestionSchema>;

export interface LayaPredictRequest {
  state: unknown;
  questions: Record<string, LayaQuestion>;
  model?: string;
  lang?: string;
  maxLen?: number;
  headMaxLen?: number;
}
export interface LayaChoiceAnswer { type: 'choice'; choice: string; probabilities: Record<string, number>; confidence?: number; answerConfidence?: number; }
export interface LayaScoreAnswer { type: 'score'; score: number; probabilities: Record<string, number>; legend?: Record<string, string>; confidence?: number; answerConfidence?: number; }
export interface LayaNoulAnswer { type: 'noul'; noul: number; confidence?: number; answerConfidence?: number; }
export type LayaAnswer = LayaChoiceAnswer | LayaScoreAnswer | LayaNoulAnswer;
export interface LayaPredictResponse {
  model?: string;
  answers: Record<string, LayaAnswer>;
  usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
  routing?: Record<string, unknown>;
}
export interface LayaDecision {
  questionId: string;
  type: LayaQuestionType;
  answer: LayaAnswer;
  calibrated: boolean;
  temperature: number;
  accepted: boolean;
  threshold?: number;
}
export interface LayaDecisionBundle {
  requestType: string;
  providerId: string;
  model?: string;
  decisions: LayaDecision[];
  accepted: boolean;
  reason: string;
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  routing?: Record<string, unknown>;
}
export interface LayaDecisionAdapter {
  readonly id: string;
  predict(request: LayaPredictRequest): Promise<LayaPredictResponse>;
  health(): Promise<{ healthy: boolean; error?: string }>;
  load?(): Promise<void>;
  unload?(): Promise<void>;
}
export interface LayaCalibrationConfig {
  enabled: boolean;
  choiceTemperature: number;
  scoreTemperature: number;
  noulTemperature: number;
  minimumConfidence: number;
  minimumProbability: number;
}
export const DEFAULT_LAYA_CALIBRATION: LayaCalibrationConfig = {
  enabled: false, choiceTemperature: 1, scoreTemperature: 1, noulTemperature: 1,
  minimumConfidence: 0.6, minimumProbability: 0.6,
};
