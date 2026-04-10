import {
  ProviderConfig,
  LLMProvider,
  ChatRequest,
  ChatResponse,
  ProviderStatus,
  ModelInfo,
  ProviderIssue,
} from "../types.js";
import { resolveCredentials, buildAuthHeaders } from "../credentials.js";
import { validateCredentials } from "../validation.js";
import { withTimeout } from "../../utils/withTimeout.js";
import { retry, isRetryableError } from "../../utils/retry.js";
import { estimateMessageTokens } from "../../utils/tokenEstimator.js";

export class OpenAICompatibleAdapter implements LLMProvider {
  readonly id: string;
  readonly type = "openai-compatible" as const;
  readonly engine: string;

  private baseUrl: string;
  private credentials: ReturnType<typeof resolveCredentials>;

  constructor(config: ProviderConfig) {
    this.id = config.id;
    this.engine = config.engine || "openai-compatible";
    this.baseUrl = (config.baseUrl || "https://api.openai.com/v1").replace(/\/$/, "");
    this.credentials = resolveCredentials(config);
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const startTime = Date.now();
    const tokenEstimate = estimateMessageTokens(request.messages);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...buildAuthHeaders(this.credentials),
    };

    const body: Record<string, unknown> = {
      model: request.model,
      messages: request.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      temperature: request.temperature,
      max_tokens: request.maxTokens,
    };

    if (request.stream) {
      body.stream = true;
    }

    const fetchFn = async (): Promise<Response> => {
      const response = await withTimeout(
        fetch(`${this.baseUrl}/chat/completions`, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        }),
        request.timeout || 120000,
        `OpenAI request (${request.model})`
      );
      return response;
    };

    let response: Response;

    try {
      response = await retry(fetchFn, {
        attempts: 3,
        baseDelay: 500,
        maxDelay: 5000,
      });
    } catch (error) {
      if (error instanceof Error && isRetryableError(error)) {
        throw new Error(`Request to '${this.id}' failed after retries: ${error.message}`);
      }
      throw error;
    }

    if (!response.ok) {
      throw await this.handleApiError(response);
    }

    const data = (await response.json()) as {
      choices: Array<{
        message: { content: string | null };
        finish_reason?: string;
      }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
      };
      model?: string;
    };

    return {
      content: data.choices[0]?.message?.content || "",
      model: data.model || request.model,
      usage: {
        inputTokens: data.usage?.prompt_tokens || tokenEstimate,
        outputTokens: data.usage?.completion_tokens || 0,
        totalTokens: data.usage?.total_tokens || tokenEstimate,
      },
      durationMs: Date.now() - startTime,
      provider: this.id,
      finishReason: data.choices[0]?.finish_reason,
    };
  }

  async listModels(): Promise<ModelInfo[]> {
    try {
      const headers = buildAuthHeaders(this.credentials);

      const response = await withTimeout(
        fetch(`${this.baseUrl}/models`, { headers }),
        5000,
        `List models from ${this.id}`
      );

      if (response.ok) {
        const data = (await response.json()) as {
          data?: Array<{ id: string }>;
        };
        return (data.data || []).map((m) => ({
          name: m.id,
          verified: true,
        }));
      }
    } catch {
      // Model listing is optional
    }

    return [];
  }

  async healthCheck(): Promise<ProviderStatus> {
    const issues: ProviderIssue[] = [];
    const startTime = Date.now();

    const validation = validateCredentials({
      id: this.id,
      type: this.type,
      credentials: this.credentials ?? undefined,
      baseUrl: this.baseUrl,
    });
    issues.push(...validation.issues);

    let latencyMs = Date.now() - startTime;
    let available = false;

    try {
      const fetchFn = async (): Promise<Response> => {
        return withTimeout(
          fetch(`${this.baseUrl}/models`, {
            headers: buildAuthHeaders(this.credentials),
          }),
          5000,
          `Health check for ${this.id}`
        );
      };

      const response = await retry(fetchFn, {
        attempts: 2,
        baseDelay: 200,
        maxDelay: 1000,
      });

      latencyMs = Date.now() - startTime;

      if (response.ok) {
        available = true;
      } else if (response.status === 401 || response.status === 403) {
        issues.push({
          severity: "fatal",
          code: "INVALID_CREDENTIALS",
          message: `Credentials for provider '${this.id}' are invalid or expired.`,
          fix: [
            `Check your API key in eamilos.yaml or .env file`,
            `Verify the key hasn't expired or been revoked`,
          ],
          autoFixable: false,
        });
      } else if (response.status === 429) {
        issues.push({
          severity: "warning",
          code: "RATE_LIMITED",
          message: `Provider '${this.id}' is rate limited.`,
          fix: [`Wait a moment and try again.`],
          autoFixable: false,
        });
        available = true;
      } else {
        issues.push({
          severity: "fatal",
          code: "API_ERROR",
          message: `API returned error ${response.status}`,
          fix: [`Check the API status and your configuration.`],
          autoFixable: false,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      issues.push({
        severity: "fatal",
        code: "CONNECTION_FAILED",
        message: `Cannot connect to '${this.baseUrl}'. ${message}`,
        fix: [
          `Check the baseUrl in your configuration`,
          `Verify your internet connection`,
          `Ensure the API service is running`,
        ],
        autoFixable: false,
      });
    }

    return {
      id: this.id,
      type: this.type,
      engine: this.engine,
      available,
      latencyMs,
      issues,
      models: [],
      capabilities: {
        chat: true,
        streaming: true,
        embeddings: false,
        functionCalling: true,
      },
      lastChecked: new Date(),
      score: 0,
    };
  }

  supportsModel(_modelId: string): boolean {
    return true;
  }

  private async handleApiError(response: Response): Promise<Error> {
    let message: string;
    try {
      const body = (await response.json()) as { error?: { message?: string } };
      message = body.error?.message || `HTTP ${response.status}`;
    } catch {
      message = `HTTP ${response.status}`;
    }

    if (response.status === 401 || response.status === 403) {
      return new Error(`Invalid or expired credentials for '${this.id}'. Check your API key.`);
    }
    if (response.status === 404) {
      return new Error(`Model not found. Check the model name in your configuration.`);
    }
    if (response.status === 429) {
      return new Error(`Rate limited. Wait before making more requests.`);
    }

    return new Error(`API error (${response.status}): ${message}`);
  }
}
