import { exec } from "child_process";
import { promisify } from "util";
import {
  ProviderConfig,
  LLMProvider,
  ChatRequest,
  ChatResponse,
  ProviderStatus,
  ModelInfo,
  ProviderIssue,
} from "../types.js";
import { withTimeout } from "../../utils/withTimeout.js";
import { retry, isRetryableError } from "../../utils/retry.js";
import { estimateMessageTokens } from "../../utils/tokenEstimator.js";

const execAsync = promisify(exec);

export class OllamaAdapter implements LLMProvider {
  readonly id: string;
  readonly type = "local" as const;
  readonly engine = "ollama";

  private baseUrl: string;

  constructor(config: ProviderConfig) {
    this.id = config.id;
    this.baseUrl = config.baseUrl || "http://localhost:11434";
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const startTime = Date.now();
    const tokenEstimate = estimateMessageTokens(request.messages);

    const ollamaMessages = request.messages.map((m) => ({
      role: m.role,
      content: m.content || "",
    }));

    const body: Record<string, unknown> = {
      model: request.model,
      messages: ollamaMessages,
      stream: false,
    };

    if (request.temperature !== undefined) {
      body.options = { temperature: request.temperature };
    }

    if (request.maxTokens) {
      if (!body.options) body.options = {};
      (body.options as Record<string, unknown>).num_predict = request.maxTokens;
    }

    const fetchFn = async (): Promise<Response> => {
      return withTimeout(
        fetch(`${this.baseUrl}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
        request.timeout || 120000,
        `Ollama request (${request.model})`
      );
    };

    let response: Response;

    try {
      response = await retry(fetchFn, {
        attempts: 3,
        baseDelay: 500,
        maxDelay: 3000,
      });
    } catch (error) {
      if (error instanceof Error && isRetryableError(error)) {
        throw new Error(`Ollama request failed after retries: ${error.message}`);
      }
      throw error;
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ollama API error: ${response.status} - ${errorText}`);
    }

    const data = (await response.json()) as {
      message?: { content?: string };
      done_reason?: string;
    };

    return {
      content: data.message?.content || "",
      model: request.model,
      usage: { inputTokens: tokenEstimate, outputTokens: 0, totalTokens: tokenEstimate },
      durationMs: Date.now() - startTime,
      provider: this.id,
      finishReason: data.done_reason,
    };
  }

  async listModels(): Promise<ModelInfo[]> {
    try {
      const response = await withTimeout(
        fetch(`${this.baseUrl}/api/tags`),
        5000,
        `List Ollama models`
      );

      if (response.ok) {
        const data = (await response.json()) as {
          models?: Array<{
            name: string;
            size?: number;
            digest?: string;
          }>;
        };
        return (data.models || []).map((m) => ({
          name: m.name,
          size: m.size ? formatSize(m.size) : undefined,
          verified: true,
        }));
      }
    } catch {
      // Model listing failed
    }

    return [];
  }

  async healthCheck(): Promise<ProviderStatus> {
    const issues: ProviderIssue[] = [];
    const startTime = Date.now();

    // Check 1: Binary installation
    try {
      await execAsync("ollama --version");
    } catch {
      issues.push({
        severity: "fatal",
        code: "LOCAL_ENGINE_NOT_INSTALLED",
        message: "Ollama is not installed on this system",
        fix: [
          "Install from https://ollama.ai",
          "Or: curl -fsSL https://ollama.ai/install.sh | sh",
          "Or use a different provider (API or openai-compatible)",
        ],
        autoFixable: false,
      });

      return this.buildStatus(issues, Date.now() - startTime, false);
    }

    // Check 2: Service running
    try {
      await withTimeout(
        fetch(`${this.baseUrl}/api/version`),
        3000,
        "Ollama service check"
      );
    } catch {
      issues.push({
        severity: "fatal",
        code: "LOCAL_SERVICE_NOT_RUNNING",
        message: "Ollama is installed but the service is not running",
        fix: [
          "Run: ollama serve",
          "Or: brew services start ollama (macOS)",
          "Or: systemctl start ollama (Linux)",
        ],
        autoFixable: true,
      });

      return this.buildStatus(issues, Date.now() - startTime, false);
    }

    // Check 3: Model availability
    const models = await this.listModels();

    if (models.length === 0) {
      issues.push({
        severity: "fatal",
        code: "LOCAL_NO_MODELS",
        message: "Ollama is running but has no models downloaded",
        fix: [
          "Run: ollama pull phi3:mini (small, 2.3GB, fast)",
          "Or: ollama pull llama3 (larger, smarter)",
          "Or: ollama pull deepseek-coder:6.7b (optimized for code)",
        ],
        autoFixable: true,
      });

      return this.buildStatus(issues, Date.now() - startTime, false);
    }

    // Check 4: Lightweight response test
    try {
      await withTimeout(
        this.chat({
          model: models[0].name,
          messages: [{ role: "user", content: "ok" }],
          maxTokens: 5,
        }),
        15000,
        "Ollama response test"
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      issues.push({
        severity: "warning",
        code: "LOCAL_MODEL_UNRESPONSIVE",
        message: `Model '${models[0].name}' not responding: ${message}`,
        fix: ["Try restarting Ollama: ollama serve"],
        autoFixable: false,
      });
    }

    return this.buildStatus(issues, Date.now() - startTime, true, models);
  }

  supportsModel(_modelId: string): boolean {
    return true;
  }

  async attemptAutoStart(): Promise<boolean> {
    try {
      const isWindows = process.platform === "win32";
      if (isWindows) {
        await execAsync("start /B ollama serve");
      } else {
        await execAsync("nohup ollama serve > /dev/null 2>&1 &");
      }

      // Wait for service to start
      for (let i = 0; i < 10; i++) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        try {
          await withTimeout(fetch(`${this.baseUrl}/api/version`), 1000, "Ollama auto-start");
          return true;
        } catch {
          // Still waiting
        }
      }
    } catch {
      // Auto-start failed
    }
    return false;
  }

  private buildStatus(
    issues: ProviderIssue[],
    latencyMs: number,
    available: boolean,
    models?: ModelInfo[]
  ): ProviderStatus {
    return {
      id: this.id,
      type: this.type,
      engine: this.engine,
      available,
      latencyMs,
      issues,
      models: models || [],
      capabilities: {
        chat: true,
        streaming: false,
        embeddings: false,
        functionCalling: false,
        maxContextLength: 8192,
      },
      lastChecked: new Date(),
      score: 0,
    };
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
