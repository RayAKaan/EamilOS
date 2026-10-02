import type { LayaDecisionAdapter, LayaPredictRequest, LayaPredictResponse } from './LayaDecisionTypes.js';
export interface LayaHttpDecisionOptions { endpoint: string; apiKey?: string; timeoutMs?: number; model?: string; }
export class LayaHttpDecisionAdapter implements LayaDecisionAdapter {
  readonly id = 'laya-http-typed';
  constructor(private readonly options: LayaHttpDecisionOptions) {}
  async predict(request: LayaPredictRequest): Promise<LayaPredictResponse> {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 60_000);
    try {
      const response = await fetch(this.url('/v1/systemone'), { method: 'POST', headers: { 'content-type': 'application/json', ...(this.options.apiKey ? { authorization: 'Bearer ' + this.options.apiKey } : {}) }, body: JSON.stringify({ ...request, model: request.model ?? this.options.model ?? 'typed-decisions', max_len: request.maxLen, head_max_len: request.headMaxLen }), signal: controller.signal });
      const body = await response.text(); if (!response.ok) throw new Error('Laya HTTP ' + response.status + ': ' + body.slice(0, 500)); return JSON.parse(body) as LayaPredictResponse;
    } catch (error) { if (error instanceof Error && error.name === 'AbortError') throw new Error('Laya HTTP inference timed out'); throw error; } finally { clearTimeout(timer); }
  }
  async health() {
    try { const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 5000); const response = await fetch(this.url('/health'), { signal: controller.signal }); clearTimeout(timer); return response.ok ? { healthy: true } : { healthy: false, error: 'HTTP ' + response.status }; }
    catch (error) { return { healthy: false, error: error instanceof Error ? error.message : String(error) }; }
  }
  private url(path: string) { return this.options.endpoint.replace(/\/$/, '') + path; }
}
