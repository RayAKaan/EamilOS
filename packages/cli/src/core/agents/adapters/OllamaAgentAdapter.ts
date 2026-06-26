import { EamilOSAgent, AgentRequest, AgentResponse, AgentKind, AgentCapabilities, RegisteredAgent } from '../EamilOSAgent.js';

export class OllamaAgentAdapter implements EamilOSAgent {
  id = 'ollama';
  name = 'Ollama (Local)';
  kind: AgentKind = 'local';
  capabilities: AgentCapabilities = {
    codeGeneration: true,
    fileEditing: false,
    commandExecution: false,
    webResearch: false,
    longContext: true,
    local: true,
    cloud: false,
    multimodal: false,
  };
  private endpoint: string;
  private model: string;

  constructor(endpoint?: string, model?: string) {
    this.endpoint = endpoint || 'http://localhost:11434';
    this.model = model || 'qwen2.5-coder:7b';
  }

  async checkStatus(): Promise<RegisteredAgent> {
    try {
      const response = await fetch(`${this.endpoint}/api/tags`, {
        signal: AbortSignal.timeout(2000),
      });
      if (response.ok) {
        const data = await response.json() as any;
        const models = (data.models || []).map((m: any) => m.name);
        const hasModel = models.some((m: string) => m.startsWith(this.model.split(':')[0]));
        return {
          id: this.id,
          name: 'Ollama (Local)',
          kind: this.kind,
          provider: 'ollama',
          status: hasModel ? 'available' : 'available',
          version: models.join(', '),
          capabilities: this.capabilities,
          supportedModes: ['communication'],
          priority: 6,
          error: hasModel ? undefined : `Model ${this.model} not found, but Ollama is running`,
        };
      }
      return {
        id: this.id,
        name: 'Ollama (Local)',
        kind: this.kind,
        provider: 'ollama',
        status: 'unavailable',
        capabilities: this.capabilities,
        supportedModes: ['communication'],
        priority: 6,
        error: 'Ollama API returned non-OK status',
      };
    } catch {
      return {
        id: this.id,
        name: 'Ollama (Local)',
        kind: this.kind,
        provider: 'ollama',
        status: 'not_installed',
        capabilities: this.capabilities,
        supportedModes: ['communication'],
        priority: 6,
        error: 'Ollama not running on port 11434',
      };
    }
  }

  async run(request: AgentRequest): Promise<AgentResponse> {
    const start = Date.now();
    try {
      const response = await fetch(`${this.endpoint}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: request.systemPrompt },
            { role: 'user', content: request.prompt },
          ],
          stream: false,
          options: {
            temperature: 0.3,
            num_predict: 4096,
          },
        }),
        signal: AbortSignal.timeout(request.timeoutMs),
      });

      if (!response.ok) {
        return {
          agentId: this.id,
          success: false,
          content: '',
          fileChanges: [],
          error: `Ollama API error ${response.status}`,
          errorType: 'unknown',
          durationMs: Date.now() - start,
        };
      }

      const data = await response.json() as any;
      const content = data.message?.content || '';

      return {
        agentId: this.id,
        success: true,
        content,
        fileChanges: [],
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
