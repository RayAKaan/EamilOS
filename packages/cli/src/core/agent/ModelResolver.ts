import {
  AgentConfig,
  FallbackStrategy,
  ModelResolution,
  LLMProvider,
} from "../providers/types.js";
import { ExplainableError } from "../errors/ExplainableError.js";
import { Phase1ModelRegistry } from "../models/Phase1ModelRegistry.js";

export class ModelResolver {
  constructor(
    private providerManager: {
      getProvider(id: string): LLMProvider | undefined;
      getProviderStatus(id: string): { available: boolean; models: Array<{ name: string; tags?: string[] }> } | undefined;
      findProviderForModel(model: string): string | null;
      getBestAvailableModel(
        preferTags?: string[],
        filterFn?: (status: { type: string }) => boolean
      ): { model: string; provider: string } | null;
    },
    private defaultModel?: string
  ) {}

  resolve(
    agent: AgentConfig,
    taskModel?: string
  ): ModelResolution {
    if (agent.model) {
      const result = this.tryModel(agent.model, agent.provider);
      if (result) return { ...result, source: "agent" };
      console.warn(`Agent '${agent.id}': preferred model '${agent.model}' not available`);
    }

    if (taskModel) {
      const result = this.tryModel(taskModel);
      if (result) return { ...result, source: "task" };
    }

    if (agent.fallbackChain) {
      for (const strategy of agent.fallbackChain) {
        const result = this.executeFallbackStrategy(strategy, agent);
        if (result) {
          console.log(`Agent '${agent.id}': using fallback → ${result.resolvedModel} (${strategy.type})`);
          return { ...result, source: "fallback" };
        }
      }
    }

    if (this.defaultModel) {
      const result = this.tryModel(this.defaultModel);
      if (result) return { ...result, source: "config" };
    }

    const agentMeta = Phase1ModelRegistry.getMetadata(agent.model || "");
    const preferTags = agentMeta.tags as string[] || [];
    const best = this.providerManager.getBestAvailableModel(preferTags);
    if (best) {
      console.log(`Agent '${agent.id}': auto-selected '${best.model}' from '${best.provider}'`);
      return {
        resolvedModel: best.model,
        resolvedProvider: best.provider,
        source: "auto",
      };
    }

    const recommendations = Phase1ModelRegistry.recommend({
      taskType: this.inferTaskType(agent),
      availableProviders: [],
      preferLocal: true,
    });

    throw new ExplainableError({
      code: "NO_MODEL_AVAILABLE",
      title: `No Model Available for Agent '${agent.id}'`,
      message: `Could not find any usable model. All providers and fallback strategies exhausted.`,
      fixes: [
        agent.model
          ? `Install the requested model: ollama pull ${agent.model}`
          : "Pull a model: ollama pull phi3:mini",
        recommendations.length > 0
          ? `Recommended models for this task: ${recommendations.slice(0, 3).map((r) => r.id).join(", ")}`
          : "Configure at least one provider in eamilos.yaml",
        "Run 'eamilos setup' for guided configuration",
      ],
    });
  }

  private executeFallbackStrategy(
    strategy: FallbackStrategy,
    agent: AgentConfig
  ): ModelResolution | null {
    switch (strategy.type) {
      case "specific-model":
        return this.tryModel(strategy.model!);

      case "same-provider": {
        const currentProvider = agent.provider || this.inferProvider(agent.model);
        if (!currentProvider) return null;
        const status = this.providerManager.getProviderStatus(currentProvider);
        if (!status?.available) return null;
        const candidate = status.models
          .filter(
            (m) =>
              !strategy.preferTags ||
              strategy.preferTags.some((t) => (m.tags as string[])?.includes(t))
          )
          .sort((a, b) => ((b.tags?.length) || 0) - ((a.tags?.length) || 0))[0];
        return candidate
          ? { resolvedModel: candidate.name, resolvedProvider: currentProvider, source: "fallback" }
          : null;
      }

      case "any-local": {
        const result = this.providerManager.getBestAvailableModel(
          strategy.preferTags as string[],
          (status) => status.type === "local"
        );
        return result 
          ? { resolvedModel: result.model, resolvedProvider: result.provider, source: "fallback" }
          : null;
      }

      case "any-api": {
        const result = this.providerManager.getBestAvailableModel(
          strategy.preferTags as string[],
          (status) => status.type === "api" || status.type === "openai-compatible"
        );
        return result
          ? { resolvedModel: result.model, resolvedProvider: result.provider, source: "fallback" }
          : null;
      }

      case "any-available": {
        const result = this.providerManager.getBestAvailableModel(strategy.preferTags as string[]);
        return result
          ? { resolvedModel: result.model, resolvedProvider: result.provider, source: "fallback" }
          : null;
      }

      default:
        return null;
    }
  }

  private tryModel(model: string, preferredProvider?: string): ModelResolution | null {
    if (preferredProvider) {
      const status = this.providerManager.getProviderStatus(preferredProvider);
      if (status?.available && status.models.some((m) => m.name === model)) {
        return { resolvedModel: model, resolvedProvider: preferredProvider, source: "agent" };
      }
    }

    const provider = this.providerManager.findProviderForModel(model);
    if (provider) {
      return { resolvedModel: model, resolvedProvider: provider, source: "agent" };
    }

    return null;
  }

  private inferProvider(model?: string): string | null {
    if (!model) return null;
    return this.providerManager.findProviderForModel(model);
  }

  private inferTaskType(agent: AgentConfig): string {
    const role = agent.role.toLowerCase();
    if (role.includes("code") || role.includes("program") || role.includes("develop"))
      return "coding";
    if (role.includes("plan") || role.includes("architect") || role.includes("design"))
      return "reasoning";
    if (role.includes("review") || role.includes("valid") || role.includes("check"))
      return "fast";
    return "general";
  }
}
