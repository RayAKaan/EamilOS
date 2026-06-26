import { EamilOSAgent, AgentRequest, AgentResponse, AgentKind, AgentCapabilities, RegisteredAgent } from '../EamilOSAgent.js';

export class GoogleAgentAdapter implements EamilOSAgent {
  id = 'google-api';
  name = 'Google AI';
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
    this.apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || '';
  }

  async checkStatus(): Promise<RegisteredAgent> {
    const available = !!this.apiKey;
    return {
      id: this.id,
      name: this.name,
      kind: this.kind,
      provider: 'google',
      status: available ? 'available' : 'auth_missing',
      capabilities: this.capabilities,
      supportedModes: ['communication'],
      priority: 9,
      error: available ? undefined : 'GOOGLE_API_KEY not set',
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
          error: 'GOOGLE_API_KEY not set',
          errorType: 'auth_missing',
          durationMs: Date.now() - start,
        };
      }

      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${this.apiKey}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [{ text: `${request.systemPrompt}\n\n${request.prompt}` }],
            },
          ],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 4096,
          },
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
          error: `Google API error ${response.status}: ${text.slice(0, 200)}`,
          errorType: response.status === 429 ? 'rate_limited' : response.status === 403 ? 'auth_failed' : 'unknown',
          durationMs: Date.now() - start,
        };
      }

      const data = await response.json() as any;
      const content = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

      return {
        agentId: this.id,
        success: true,
        content,
        fileChanges: [],
        tokensUsed: data.usageMetadata?.totalTokenCount,
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
