import { extractFileChanges } from '../../parsers/ResponseParser.js';
import { EamilOSAgent, AgentRequest, AgentResponse, AgentKind, AgentCapabilities, RegisteredAgent } from '../EamilOSAgent.js';

export class OpenAIAgentAdapter implements EamilOSAgent {
  id = 'openai-api';
  name = 'OpenAI API';
  kind: AgentKind = 'api';
  capabilities: AgentCapabilities = {
    codeGeneration: true,
    fileEditing: false,
    commandExecution: false,
    webResearch: false,
    longContext: true,
    local: false,
    cloud: true,
    multimodal: true,
  };
  private apiKey: string;

  constructor() {
    this.apiKey = process.env.OPENAI_API_KEY || '';
  }

  async checkStatus(): Promise<RegisteredAgent> {
    const available = !!this.apiKey;
    return {
      id: this.id,
      name: this.name,
      kind: this.kind,
      provider: 'openai',
      status: available ? 'available' : 'auth_missing',
      capabilities: this.capabilities,
      supportedModes: ['communication'],
      priority: 7,
      error: available ? undefined : 'OPENAI_API_KEY not set',
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
          error: 'OPENAI_API_KEY not set',
          errorType: 'auth_missing',
          durationMs: Date.now() - start,
        };
      }

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [
            { role: 'system', content: request.systemPrompt },
            { role: 'user', content: request.prompt },
          ],
          max_tokens: 4096,
          temperature: 0.3,
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
          error: `OpenAI API error ${response.status}: ${text.slice(0, 200)}`,
          errorType: response.status === 429 ? 'rate_limited' : response.status === 401 ? 'auth_failed' : 'unknown',
          durationMs: Date.now() - start,
        };
      }

      const data = await response.json() as any;
      const content = data.choices?.[0]?.message?.content || '';

      const fileChanges = extractFileChanges(content, this.id);
      return {
        agentId: this.id,
        success: true,
        content,
        fileChanges,
        tokensUsed: data.usage?.total_tokens,
        costUsd: data.usage?.total_tokens ? (data.usage.total_tokens / 1000000) * 10 : undefined,
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
