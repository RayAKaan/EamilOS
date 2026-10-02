import type { IntelligenceCapabilities, IntelligenceHealth, IntelligenceProvider, IntelligenceRequest, IntelligenceResponse } from './IntelligenceRuntimeTypes.js';
import type { DecisionContext } from './types.js';
import { LayaCalibration } from './LayaCalibration.js';
import { LayaQuestionBuilder } from './LayaQuestionBuilder.js';
import { DEFAULT_LAYA_CALIBRATION, LayaPredictResponseSchema, type LayaDecisionAdapter, type LayaDecisionBundle, type LayaPredictResponse } from './LayaDecisionTypes.js';

export class LayaTypedDecisionProvider implements IntelligenceProvider {
  readonly id = 'laya-typed';
  constructor(private readonly adapter: LayaDecisionAdapter, private readonly calibration = new LayaCalibration(DEFAULT_LAYA_CALIBRATION), private readonly questions = new LayaQuestionBuilder()) {}
  capabilities(): IntelligenceCapabilities { return { strategicDecision: true, taskDecision: true, recoveryDecision: true, planning: false, validationAssessment: true, agentSelection: true, parallelization: true, local: this.adapter.id === 'laya-local', remote: this.adapter.id === 'laya-http', streaming: false }; }
  async initialize() { await this.adapter.load?.(); }
  async health(): Promise<IntelligenceHealth> { const started = Date.now(); const health = await this.adapter.health(); return { providerId: this.id, status: health.healthy ? 'READY' : 'UNAVAILABLE', checkedAt: new Date().toISOString(), latencyMs: Date.now() - started, error: health.error, capabilities: this.capabilities() }; }
  async evaluate(request: IntelligenceRequest): Promise<IntelligenceResponse<LayaDecisionBundle>> {
    const started = Date.now();
    try {
      const build = this.questions.build(request, request.context as DecisionContext);
      if (!build.questionIds.length) return this.response(request, 'REJECTED', undefined, started, 'NO_QUESTION');
      const raw: LayaPredictResponse = LayaPredictResponseSchema.parse(await this.adapter.predict(build.request)) as LayaPredictResponse;
      const decisions = build.questionIds.map(questionId => { const answer = raw.answers?.[questionId]; if (!answer) throw new Error('Laya response omitted answer for ' + questionId); return this.calibration.apply(questionId, answer); });
      const accepted = decisions.every(decision => decision.accepted);
      const result: LayaDecisionBundle = { requestType: request.type, providerId: this.id, model: raw.model, decisions, accepted, reason: accepted ? 'All Laya decisions met confidence gates.' : 'At least one Laya decision fell below the configured confidence gate.', usage: raw.usage ? { inputTokens: raw.usage.input_tokens, outputTokens: raw.usage.output_tokens, totalTokens: raw.usage.total_tokens } : undefined, routing: raw.routing };
      return this.response(request, accepted ? 'SUCCESS' : 'DEGRADED', result, started);
    } catch (error) { return this.response(request, 'FAILED', undefined, started, 'LAYA_INFERENCE_FAILED', error); }
  }
  async shutdown() { await this.adapter.unload?.(); }
  private response(request: IntelligenceRequest, status: IntelligenceResponse['status'], result: LayaDecisionBundle | undefined, started: number, code?: string, error?: unknown): IntelligenceResponse<LayaDecisionBundle> {
    return { requestId: request.requestId, providerId: this.id, status, result, confidence: result?.decisions.length ? Math.min(...result.decisions.map(d => d.answer.answerConfidence ?? d.answer.confidence ?? 0)) : undefined, latencyMs: Date.now() - started, contextVersion: request.contextVersion, contextHash: request.contextHash, ...(code ? { error: { code, message: error instanceof Error ? error.message : code, retryable: status === 'FAILED' } } : {}) };
  }
}
