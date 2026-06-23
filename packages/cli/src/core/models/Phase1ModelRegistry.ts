import { ModelMetadata, ModelTag } from "../providers/types.js";

const MODEL_CATALOG: ModelMetadata[] = [
  {
    id: "gpt-4o",
    aliases: ["gpt4o"],
    provider: "openai",
    tags: ["reasoning", "coding", "multimodal", "premium", "long-context"],
    contextWindow: 128000,
    costTier: "premium",
    recommendedFor: ["complex reasoning", "code review", "architecture planning", "multimodal tasks"],
    description: "Most capable OpenAI model — reasoning + vision + code",
  },
  {
    id: "gpt-4o-mini",
    aliases: ["gpt4o-mini", "gpt-4-mini"],
    provider: "openai",
    tags: ["fast", "cheap", "general", "coding", "long-context"],
    contextWindow: 128000,
    costTier: "cheap",
    recommendedFor: ["general tasks", "quick code generation", "summarization", "classification"],
    description: "Fast, affordable OpenAI model — best value for most tasks",
  },
  {
    id: "gpt-4-turbo",
    aliases: ["gpt4-turbo"],
    provider: "openai",
    tags: ["reasoning", "coding", "long-context", "premium"],
    contextWindow: 128000,
    costTier: "premium",
    recommendedFor: ["complex analysis", "long document processing"],
    description: "Previous-gen flagship — still excellent for complex tasks",
  },
  {
    id: "gpt-3.5-turbo",
    aliases: ["gpt35", "gpt-3.5"],
    provider: "openai",
    tags: ["fast", "cheap", "general"],
    contextWindow: 16385,
    costTier: "cheap",
    recommendedFor: ["simple tasks", "classification", "formatting"],
    description: "Legacy but fast — good for simple, high-volume tasks",
  },
  {
    id: "o1",
    aliases: ["o1-preview"],
    provider: "openai",
    tags: ["reasoning", "premium"],
    contextWindow: 128000,
    costTier: "premium",
    recommendedFor: ["deep reasoning", "math", "complex problem solving"],
    description: "Reasoning-specialized model with chain-of-thought",
  },
  {
    id: "o1-mini",
    aliases: [],
    provider: "openai",
    tags: ["reasoning", "coding", "fast"],
    contextWindow: 128000,
    costTier: "moderate",
    recommendedFor: ["coding", "math", "analytical tasks"],
    description: "Smaller reasoning model — great for code and math",
  },
  {
    id: "claude-3-opus",
    aliases: ["claude-3-opus-20240229", "opus"],
    provider: "anthropic",
    tags: ["reasoning", "premium", "long-context"],
    contextWindow: 200000,
    costTier: "premium",
    recommendedFor: ["complex analysis", "nuanced writing", "research"],
    description: "Most powerful Claude — exceptional reasoning and nuance",
  },
  {
    id: "claude-3.5-sonnet",
    aliases: ["claude-3-5-sonnet-20241022", "sonnet"],
    provider: "anthropic",
    tags: ["reasoning", "coding", "general", "long-context"],
    contextWindow: 200000,
    costTier: "moderate",
    recommendedFor: ["coding", "analysis", "general tasks", "best overall value"],
    description: "Best balance of capability and cost in the Claude family",
  },
  {
    id: "claude-3-haiku",
    aliases: ["claude-3-haiku-20240307", "haiku"],
    provider: "anthropic",
    tags: ["fast", "cheap", "general"],
    contextWindow: 200000,
    costTier: "cheap",
    recommendedFor: ["quick tasks", "classification", "extraction", "high volume"],
    description: "Fastest Claude — ideal for simple, high-speed tasks",
  },
  {
    id: "claude-3.5-haiku",
    aliases: ["claude-3-5-haiku-20241022"],
    provider: "anthropic",
    tags: ["fast", "cheap", "coding", "general"],
    contextWindow: 200000,
    costTier: "cheap",
    recommendedFor: ["coding assistance", "quick analysis", "data processing"],
    description: "Upgraded Haiku — faster with coding capabilities",
  },
  {
    id: "gemini-1.5-pro",
    aliases: ["gemini-pro"],
    provider: "google",
    tags: ["reasoning", "multimodal", "long-context", "premium"],
    contextWindow: 1000000,
    costTier: "moderate",
    recommendedFor: ["very long documents", "multimodal analysis", "research"],
    description: "1M token context — unmatched for long document processing",
  },
  {
    id: "gemini-1.5-flash",
    aliases: ["gemini-flash"],
    provider: "google",
    tags: ["fast", "cheap", "multimodal", "long-context"],
    contextWindow: 1000000,
    costTier: "cheap",
    recommendedFor: ["quick multimodal tasks", "long document summarization"],
    description: "Fast Gemini variant — 1M context at low cost",
  },
  {
    id: "gemini-2.0-flash",
    aliases: ["gemini-2-flash"],
    provider: "google",
    tags: ["fast", "cheap", "multimodal", "reasoning"],
    contextWindow: 1000000,
    costTier: "cheap",
    recommendedFor: ["general tasks", "agentic workflows", "multimodal"],
    description: "Next-gen Flash — improved reasoning and speed",
  },
  {
    id: "llama3",
    aliases: ["llama3:latest", "llama3:8b"],
    provider: "ollama",
    tags: ["general", "local", "fast"],
    contextWindow: 8192,
    costTier: "free",
    minRAM: 8,
    recommendedFor: ["general local tasks", "chat", "basic coding"],
    description: "Meta's latest open model — strong general performance",
  },
  {
    id: "llama3:70b",
    aliases: ["llama3-70b"],
    provider: "ollama",
    tags: ["reasoning", "local", "premium"],
    contextWindow: 8192,
    costTier: "free",
    minRAM: 48,
    recommendedFor: ["complex local tasks", "when privacy matters"],
    description: "Large Llama — near-GPT-4 quality, runs locally",
  },
  {
    id: "llama3.1",
    aliases: ["llama3.1:latest", "llama3.1:8b"],
    provider: "ollama",
    tags: ["general", "local", "long-context"],
    contextWindow: 131072,
    costTier: "free",
    minRAM: 8,
    recommendedFor: ["long document tasks", "general local use"],
    description: "Extended context Llama — 128k tokens locally",
  },
  {
    id: "llama3.2",
    aliases: ["llama3.2:latest", "llama3.2:3b"],
    provider: "ollama",
    tags: ["small", "fast", "local", "cheap"],
    contextWindow: 131072,
    costTier: "free",
    minRAM: 4,
    recommendedFor: ["lightweight tasks", "low-resource machines"],
    description: "Compact Llama — runs on minimal hardware",
  },
  {
    id: "mistral",
    aliases: ["mistral:latest", "mistral:7b"],
    provider: "ollama",
    tags: ["fast", "local", "general"],
    contextWindow: 8192,
    costTier: "free",
    minRAM: 8,
    recommendedFor: ["fast local inference", "general tasks"],
    description: "Efficient 7B model — great speed-to-quality ratio",
  },
  {
    id: "mixtral:8x7b",
    aliases: ["mixtral"],
    provider: "ollama",
    tags: ["moe", "reasoning", "local"],
    contextWindow: 32768,
    costTier: "free",
    minRAM: 32,
    recommendedFor: ["complex local tasks", "multi-step reasoning"],
    description: "Mixture-of-Experts — expert-level with efficient compute",
  },
  {
    id: "mistral-large",
    aliases: ["mistral-large-latest"],
    provider: "mistral",
    tags: ["reasoning", "premium", "coding"],
    contextWindow: 32000,
    costTier: "moderate",
    recommendedFor: ["complex reasoning", "enterprise tasks"],
    description: "Mistral's flagship API model",
  },
  {
    id: "codestral",
    aliases: ["codestral:latest"],
    provider: "ollama",
    tags: ["coding", "local", "fast"],
    contextWindow: 32768,
    costTier: "free",
    minRAM: 16,
    recommendedFor: ["code generation", "code completion", "refactoring"],
    description: "Mistral's code-specialized model — 80+ languages",
  },
  {
    id: "deepseek-coder",
    aliases: ["deepseek-coder:latest"],
    provider: "ollama",
    tags: ["coding", "local"],
    contextWindow: 16384,
    costTier: "free",
    minRAM: 8,
    recommendedFor: ["code generation", "debugging", "code review"],
    description: "Purpose-built for coding — strong across languages",
  },
  {
    id: "deepseek-coder:6.7b",
    aliases: [],
    provider: "ollama",
    tags: ["coding", "local", "fast"],
    contextWindow: 16384,
    costTier: "free",
    minRAM: 8,
    recommendedFor: ["code generation", "quick coding tasks"],
    description: "Efficient coding model — best local code-to-size ratio",
  },
  {
    id: "deepseek-coder-v2",
    aliases: ["deepseek-coder-v2:latest"],
    provider: "ollama",
    tags: ["coding", "moe", "local", "reasoning"],
    contextWindow: 131072,
    costTier: "free",
    minRAM: 16,
    recommendedFor: ["complex coding", "large codebases", "architecture"],
    description: "MoE coding model — 128k context for large projects",
  },
  {
    id: "deepseek-chat",
    aliases: [],
    provider: "deepseek",
    tags: ["general", "reasoning", "coding"],
    contextWindow: 32768,
    costTier: "cheap",
    recommendedFor: ["general tasks", "coding", "analysis"],
    description: "DeepSeek's API chat model — excellent value",
  },
  {
    id: "qwen2.5",
    aliases: ["qwen2.5:latest", "qwen2.5:7b"],
    provider: "ollama",
    tags: ["general", "local", "coding"],
    contextWindow: 32768,
    costTier: "free",
    minRAM: 8,
    recommendedFor: ["general tasks", "coding", "multilingual"],
    description: "Strong multilingual model — excellent for diverse tasks",
  },
  {
    id: "qwen2.5:3b",
    aliases: [],
    provider: "ollama",
    tags: ["small", "fast", "local", "cheap"],
    contextWindow: 32768,
    costTier: "free",
    minRAM: 4,
    recommendedFor: ["lightweight tasks", "resource-constrained environments"],
    description: "Compact Qwen — surprisingly capable for its size",
  },
  {
    id: "qwen2.5:14b",
    aliases: [],
    provider: "ollama",
    tags: ["general", "reasoning", "local"],
    contextWindow: 32768,
    costTier: "free",
    minRAM: 16,
    recommendedFor: ["balanced local tasks", "reasoning"],
    description: "Mid-size Qwen — strong reasoning in a practical package",
  },
  {
    id: "qwen2.5-coder",
    aliases: ["qwen2.5-coder:latest", "qwen2.5-coder:7b"],
    provider: "ollama",
    tags: ["coding", "local", "fast"],
    contextWindow: 32768,
    costTier: "free",
    minRAM: 8,
    recommendedFor: ["code generation", "code review", "refactoring"],
    description: "Qwen's code-specialized variant — competitive with DeepSeek",
  },
  {
    id: "phi3:mini",
    aliases: ["phi3", "phi3:latest"],
    provider: "ollama",
    tags: ["small", "fast", "local", "cheap"],
    contextWindow: 4096,
    costTier: "free",
    minRAM: 4,
    recommendedFor: ["quick tasks", "validation", "classification", "low-resource machines"],
    description: "Tiny but mighty — ideal for validators and quick checks",
  },
  {
    id: "phi3:medium",
    aliases: [],
    provider: "ollama",
    tags: ["general", "local"],
    contextWindow: 4096,
    costTier: "free",
    minRAM: 8,
    recommendedFor: ["general tasks", "balanced local performance"],
    description: "Mid-size Phi — good balance of speed and capability",
  },
  {
    id: "phi4",
    aliases: ["phi4:latest"],
    provider: "ollama",
    tags: ["reasoning", "small", "local", "fast"],
    contextWindow: 16384,
    costTier: "free",
    minRAM: 8,
    recommendedFor: ["reasoning", "math", "science", "coding"],
    description: "Latest Phi — remarkable reasoning for its size",
  },
  {
    id: "llama3-70b-8192",
    aliases: [],
    provider: "groq",
    tags: ["fast", "reasoning", "general"],
    contextWindow: 8192,
    costTier: "cheap",
    recommendedFor: ["speed-critical tasks", "when latency matters most"],
    description: "Llama 70B on Groq — incredibly fast inference",
  },
  {
    id: "llama3-8b-8192",
    aliases: [],
    provider: "groq",
    tags: ["fast", "cheap", "general"],
    contextWindow: 8192,
    costTier: "cheap",
    recommendedFor: ["high-speed simple tasks", "real-time applications"],
    description: "Llama 8B on Groq — near-instant responses",
  },
  {
    id: "mixtral-8x7b-32768",
    aliases: [],
    provider: "groq",
    tags: ["moe", "fast", "reasoning"],
    contextWindow: 32768,
    costTier: "cheap",
    recommendedFor: ["complex tasks requiring speed", "long context with fast inference"],
    description: "Mixtral on Groq — expert-level quality at lightning speed",
  },
  {
    id: "meta-llama/Llama-3-70b-chat-hf",
    aliases: ["together-llama3-70b"],
    provider: "together",
    tags: ["reasoning", "general"],
    contextWindow: 8192,
    costTier: "cheap",
    recommendedFor: ["general tasks", "when local compute isn't available"],
    description: "Llama 70B hosted by Together — good balance of cost and quality",
  },
  {
    id: "mistralai/Mixtral-8x7B-Instruct-v0.1",
    aliases: ["together-mixtral"],
    provider: "together",
    tags: ["moe", "reasoning"],
    contextWindow: 32768,
    costTier: "cheap",
    recommendedFor: ["instruction following", "complex reasoning"],
    description: "Mixtral on Together — MoE architecture via API",
  },
  {
    id: "codellama",
    aliases: ["codellama:latest", "codellama:7b"],
    provider: "ollama",
    tags: ["coding", "local"],
    contextWindow: 16384,
    costTier: "free",
    minRAM: 8,
    recommendedFor: ["code generation", "code completion"],
    description: "Meta's code-specialized Llama variant",
  },
  {
    id: "starcoder2",
    aliases: ["starcoder2:latest"],
    provider: "ollama",
    tags: ["coding", "local"],
    contextWindow: 16384,
    costTier: "free",
    minRAM: 8,
    recommendedFor: ["code completion", "code generation"],
    description: "BigCode's star model — trained on massive code corpus",
  },
  {
    id: "nomic-embed-text",
    aliases: [],
    provider: "ollama",
    tags: ["embedding", "local"],
    contextWindow: 8192,
    costTier: "free",
    minRAM: 2,
    recommendedFor: ["embeddings", "semantic search", "RAG"],
    description: "Efficient local embedding model",
  },
  {
    id: "mxbai-embed-large",
    aliases: [],
    provider: "ollama",
    tags: ["embedding", "local"],
    contextWindow: 512,
    costTier: "free",
    minRAM: 2,
    recommendedFor: ["high-quality embeddings", "semantic similarity"],
    description: "High-quality embedding model for search and RAG",
  },
  {
    id: "gemma2",
    aliases: ["gemma2:latest", "gemma2:9b"],
    provider: "ollama",
    tags: ["general", "local", "fast"],
    contextWindow: 8192,
    costTier: "free",
    minRAM: 8,
    recommendedFor: ["general tasks", "instruction following"],
    description: "Google's open model — efficient and well-rounded",
  },
  {
    id: "gemma2:2b",
    aliases: [],
    provider: "ollama",
    tags: ["small", "fast", "local", "cheap"],
    contextWindow: 8192,
    costTier: "free",
    minRAM: 2,
    recommendedFor: ["edge deployment", "extremely resource-constrained"],
    description: "Tiny Gemma — runs on almost anything",
  },
];

const catalogMap = new Map<string, ModelMetadata>();
const aliasMap = new Map<string, string>();

for (const model of MODEL_CATALOG) {
  catalogMap.set(model.id, model);
  for (const alias of model.aliases) {
    aliasMap.set(alias, model.id);
  }
}

export class Phase1ModelRegistry {
  static getMetadata(modelId: string): Partial<ModelMetadata> {
    const direct = catalogMap.get(modelId);
    if (direct) return direct;

    const canonical = aliasMap.get(modelId);
    if (canonical) return catalogMap.get(canonical)!;

    return {
      id: modelId,
      aliases: [],
      tags: [],
      description: "Unknown model — not in EamilOS registry",
    };
  }

  static findModels(criteria: {
    tags?: ModelTag[];
    costTier?: Array<"free" | "cheap" | "moderate" | "premium">;
    maxRAM?: number;
    provider?: string;
    minContextWindow?: number;
  }): ModelMetadata[] {
    return MODEL_CATALOG.filter((model) => {
      if (criteria.tags && !criteria.tags.some((t) => model.tags.includes(t)))
        return false;
      if (
        criteria.costTier &&
        !criteria.costTier.includes(model.costTier as "free" | "cheap" | "moderate" | "premium")
      )
        return false;
      if (
        criteria.maxRAM &&
        model.minRAM &&
        model.minRAM > criteria.maxRAM
      )
        return false;
      if (criteria.provider && model.provider !== criteria.provider)
        return false;
      if (
        criteria.minContextWindow &&
        model.contextWindow < criteria.minContextWindow
      )
        return false;
      return true;
    });
  }

  static recommend(context: {
    availableRAM?: number;
    taskType?: string;
    availableProviders: string[];
    preferLocal?: boolean;
  }): ModelMetadata[] {
    const candidates = MODEL_CATALOG.filter(
      (m) =>
        context.availableProviders.includes(m.provider) ||
        m.costTier === "free"
    ).filter(
      (m) =>
        !m.minRAM || !context.availableRAM || m.minRAM <= context.availableRAM
    );

    return candidates
      .map((m) => ({
        model: m,
        score: this.scoreModel(m, context),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map((s) => s.model);
  }

  private static scoreModel(
    model: ModelMetadata,
    context: {
      preferLocal?: boolean;
      taskType?: string;
    }
  ): number {
    let score = 50;

    if (context.preferLocal && model.tags.includes("local")) score += 20;

    if (context.taskType === "coding" && model.tags.includes("coding"))
      score += 25;
    if (context.taskType === "reasoning" && model.tags.includes("reasoning"))
      score += 25;

    if (model.costTier === "free") score += 15;
    if (model.costTier === "cheap") score += 10;

    if (model.tags.includes("fast")) score += 10;

    return score;
  }

  static getModelCount(): number {
    return MODEL_CATALOG.length;
  }

  static getAllModels(): ModelMetadata[] {
    return [...MODEL_CATALOG];
  }
}

export { MODEL_CATALOG };
