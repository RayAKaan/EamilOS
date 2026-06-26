import { EamilOSAgent, AgentRequest, AgentResponse, AgentKind, AgentCapabilities, RegisteredAgent } from '../EamilOSAgent.js';

export class AnthropicAgentAdapter implements EamilOSAgent {
  id = 'anthropic-api';
  name = 'Anthropic API';
  kind: AgentKind = 'api';
  capabilities: AgentCapabilities = {
    codeGeneration: true,
    fileEditing: false,
    commandExecution: false,
    webResearch: false,
    longContext: true,
    local: false,
    cloud: true,
    multimodal: false,
  };
  private apiKey: string;

  constructor() {
    this.apiKey = process.env.ANTHROPIC_API_KEY || '';
  }

  async checkStatus(): Promise<RegisteredAgent> {
    const available = !!this.apiKey;
    return {
      id: this.id,
      name: this.name,
      kind: this.kind,
      provider: 'anthropic',
      status: available ? 'available' : 'auth_missing',
      capabilities: this.capabilities,
      supportedModes: ['communication'],
      priority: 8,
      error: available ? undefined : 'ANTHROPIC_API_KEY not set',
    };
  }

  async run(request: AgentRequest): Promise<AgentResponse> {
    const start = Date.now();
    try {
      if (!this.apiKey) {
        return {
          agentId: this.id,
          success: false,
          content: '',
          fileChanges: [],
          error: 'ANTHROPIC_API_KEY not set',
          errorType: 'auth_missing',
          durationMs: Date.now() - start,
        };
      }

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 4096,
          system: request.systemPrompt,
          messages: [
            { role: 'user', content: request.prompt },
          ],
        }),
        signal: AbortSignal.timeout(request.timeoutMs),
      });

      if (!response.ok) {
        const text = await response.text();
        return {
          agentId: this.id,
          success: false,
          content: '',
          fileChanges: [],
          error: `Anthropic API error ${response.status}: ${text.slice(0, 200)}`,
          errorType: response.status === 429 ? 'rate_limited' : response.status === 401 ? 'auth_failed' : 'unknown',
          durationMs: Date.now() - start,
        };
      }

      const data = await response.json() as any;
      const content = data.content?.[0]?.text || '';

      return {
        agentId: this.id,
        success: true,
        content,
        fileChanges: [],
        tokensUsed: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
        costUsd: undefined,
        durationMs: Date.now() - start,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        agentId: this.id,
        success: false,
        content: '',
        fileChanges: [],
        error: msg,
        errorType: msg.includes('timed out') || msg.includes('Timeout') ? 'timeout' : 'unknown',
        durationMs: Date.now() - start,
      };
    }
  }

  async stop(): Promise<void> {
  }
}
