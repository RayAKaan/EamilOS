import { ChatMessage } from '../types.js';
import type { ToolDefinition } from './types.js';

export interface LLMResponse {
  content: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface LLMProvider {
  chat(messages: ChatMessage[], tools?: ToolDefinition[]): Promise<LLMResponse>;
  chatSimple(prompt: string, system?: string): Promise<string>;
}

export function createOllamaProvider(endpoint: string, model: string): LLMProvider {
  async function chat(messages: ChatMessage[], tools?: ToolDefinition[]): Promise<LLMResponse> {
    const ollamaMessages = messages.map((m) => ({
      role: m.role,
      content: m.content || '',
    }));

    const body: Record<string, unknown> = {
      model,
      messages: ollamaMessages,
      stream: false,
    };

    if (tools && tools.length > 0) {
      body.tools = tools.map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description || '',
          parameters: t.inputSchema,
        },
      }));
    }

    const response = await fetch(`${endpoint}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Ollama API error: ${response.status} - ${error}`);
    }

    const data = await response.json() as {
      message: {
        content: string;
        tool_calls?: Array<{
          function: { name: string; arguments: string };
        }>;
      };
      done_reason?: string;
    };

    const toolCalls = data.message.tool_calls?.map((tc, idx) => ({
      id: `call_${idx}_${Date.now()}`,
      name: tc.function.name,
      arguments: JSON.parse(tc.function.arguments) as Record<string, unknown>,
    }));

    const content = data.message.content || '';

    return {
      content,
      toolCalls,
      usage: {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
      },
    };
  }

  async function chatSimple(prompt: string, system?: string): Promise<string> {
    const messages: ChatMessage[] = [];
    if (system) {
      messages.push({ role: 'system', content: system });
    }
    messages.push({ role: 'user', content: prompt });

    const response = await chat(messages);
    return response.content;
  }

  return { chat, chatSimple };
}
