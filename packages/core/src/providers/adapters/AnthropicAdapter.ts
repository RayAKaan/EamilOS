import {
  ProviderConfig,
  LLMProvider,
  ChatRequest,
  ChatResponse,
  ProviderStatus,
  ModelInfo,
  ProviderIssue,
} from "../types.js";
import { resolveCredentials } from "../credentials.js";
import { validateCredentials } from "../validation.js";
import { withTimeout } from "../../utils/withTimeout.js";
import { retry, isRetryableError } from "../../utils/retry.js";
import { estimateMessageTokens } from "../../utils/tokenEstimator.js";

export class AnthropicAdapter implements LLMProvider {
  readonly id: string;
  readonly type = "api" as const;
  readonly engine = "anthropic";

  private baseUrl = "https://api.anthropic.com/v1";
  private credentials: ReturnType<typeof resolveCredentials>;
  private version = "2023-06-01";

  constructor(config: ProviderConfig) {
    this.id = config.id;
    this.credentials = resolveCredentials(config);
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const startTime = Date.now();
    const tokenEstimate = estimateMessageTokens(request.messages);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "x-api-key": this.credentials?.apiKey || "",
      "anthropic-version": this.version,
    };

    const body: Record<string, unknown> = {
      model: request.model,
      messages: request.messages
        .filter((m) => m.role !== "system")
        .map((m) => ({
          role: m.role === "assistant" ? "assistant" : "user",
          content: m.content,
        })),
      max_tokens: request.maxTokens || 1024,
    };

    if (request.temperature !== undefined) {
      body.temperature = request.temperature;
    }

    const systemMsg = request.messages.find((m) => m.role === "system");
    if (systemMsg) {
      body.system = systemMsg.content;
    }

    const fetchFn = async (): Promise<Response> => {
      return withTimeout(
        fetch(`${this.baseUrl}/messages`, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        }),
        request.timeout || 120000,
        `Anthropic request (${request.model})`
      );
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
        throw new Error(`Anthropic request failed after retries: ${error.message}`);
      }
      throw error;
    }

    if (!response.ok) {
      throw await this.handleApiError(response);
    }

    const data = (await response.json()) as {
      content: Array<{ type: string; text?: string }>;
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
      };
      model?: string;
      stop_reason?: string;
    };

    const textContent = data.content?.find((c) => c.type === "text");
    const usage = data.usage || { input_tokens: 0, output_tokens: 0 };

    return {
      content: textContent?.text || "",
      model: data.model || request.model,
      usage: {
        inputTokens: usage.input_tokens || tokenEstimate,
        outputTokens: usage.output_tokens || 0,
        totalTokens: (usage.input_tokens || 0) + (usage.output_tokens || 0),
      },
      durationMs: Date.now() - startTime,
      provider: this.id,
      finishReason: data.stop_reason,
    };
  }

  async listModels(): Promise<ModelInfo[]> {
    const knownModels = [
      "claude-3-opus-20240229",
      "claude-3-sonnet-20240229",
      "claude-3-haiku-20240307",
      "claude-3-5-sonnet-20241022",
      "claude-3-5-haiku-20241022",
    ];

    return knownModels.map((name) => ({
      name,
      verified: false,
    }));
  }

  async healthCheck(): Promise<ProviderStatus> {
    const issues: ProviderIssue[] = [];
    const startTime = Date.now();

    const validation = validateCredentials({
      id: this.id,
      type: this.type,
      engine: this.engine,
      credentials: this.credentials ?? undefined,
    });
    issues.push(...validation.issues);

    let available = false;
    let latencyMs = Date.now() - startTime;

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "x-api-key": this.credentials?.apiKey || "",
        "anthropic-version": this.version,
      };

      const fetchFn = async (): Promise<Response> => {
        return withTimeout(
          fetch(`${this.baseUrl}/messages`, {
            method: "POST",
            headers,
            body: JSON.stringify({
              model: "claude-3-haiku-20240307",
              messages: [{ role: "user", content: "hi" }],
              max_tokens: 10,
            }),
          }),
          10000,
          "Anthropic health check"
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
      } else {
        const errorData = (await response.json().catch(() => ({}))) as {
          error?: { type?: string; message?: string };
        };
        const errorType = errorData.error?.type;

        if (response.status === 401 || response.status === 403) {
          issues.push({
            severity: "fatal",
            code: "INVALID_CREDENTIALS",
            message: `Credentials for '${this.id}' are invalid or expired.`,
            fix: [
              `Check your ANTHROPIC_API_KEY in eamilos.yaml or .env`,
              `Verify the key hasn't expired or been revoked`,
            ],
            autoFixable: false,
          });
        } else if (errorType === "rate_limit_error") {
          issues.push({
            severity: "warning",
            code: "RATE_LIMITED",
            message: `Anthropic API is rate limited.`,
            fix: [`Wait before making more requests.`],
            autoFixable: false,
          });
          available = true;
        }
      }
    } catch (error) {
      latencyMs = Date.now() - startTime;
      issues.push({
        severity: "fatal",
        code: "CONNECTION_FAILED",
        message: `Cannot connect to Anthropic API.`,
        fix: [`Check your internet connection.`],
        autoFixable: false,
      });
    }

    const models = await this.listModels();

    return {
      id: this.id,
      type: this.type,
      engine: this.engine,
      available,
      latencyMs,
      issues,
      models,
      capabilities: {
        chat: true,
        streaming: false,
        embeddings: false,
        functionCalling: false,
        maxContextLength: 200000,
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
      return new Error(`Invalid or expired credentials for '${this.id}'.`);
    }

    return new Error(`Anthropic API error (${response.status}): ${message}`);
  }
}
