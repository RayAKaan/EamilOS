import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { PluginType } from './types.js';
import { SecureLogger } from '../security/SecureLogger.js';

export interface MarketplaceEntry {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  type: PluginType;
  riskLevel: string;
  downloads: number;
  rating: number;
  source: string;
  homepage?: string;
  tags: string[];
}

export class MarketplaceRegistry {
  private registryUrl: string;
  private localCachePath: string;
  private logger: SecureLogger;

  constructor(
    registryUrl: string = "https://registry.eamilos.dev/plugins.json",
    logger: SecureLogger
  ) {
    this.registryUrl = registryUrl;
    this.localCachePath = path.join(os.homedir(), ".eamilos", "marketplace-cache.json");
    this.logger = logger;
  }

  async search(query: string): Promise<MarketplaceEntry[]> {
    const entries = await this.fetchRegistry();
    const lower = query.toLowerCase();

    return entries.filter(e =>
      e.name.toLowerCase().includes(lower) ||
      e.description.toLowerCase().includes(lower) ||
      e.tags.some(t => t.toLowerCase().includes(lower)) ||
      e.id.toLowerCase().includes(lower)
    );
  }

  async getAll(): Promise<MarketplaceEntry[]> {
    return this.fetchRegistry();
  }

  async getEntry(pluginId: string): Promise<MarketplaceEntry | null> {
    const entries = await this.fetchRegistry();
    return entries.find(e => e.id === pluginId) || null;
  }

  private async fetchRegistry(): Promise<MarketplaceEntry[]> {
    try {
      const response = await fetch(this.registryUrl, {
        signal: AbortSignal.timeout(5000)
      });

      if (response.ok) {
        const entries = await response.json() as MarketplaceEntry[];
        fs.writeFileSync(this.localCachePath, JSON.stringify(entries, null, 2));
        return entries;
      }
    } catch {
      this.logger.log("debug", "Marketplace registry unreachable, using cache");
    }

    if (fs.existsSync(this.localCachePath)) {
      return JSON.parse(fs.readFileSync(this.localCachePath, "utf-8"));
    }

    return this.getBuiltinEntries();
  }

  private getBuiltinEntries(): MarketplaceEntry[] {
    return [
      {
        id: "parallel-execution",
        name: "Parallel Execution",
        description: "Run tasks against multiple models simultaneously",
        version: "1.0.0",
        author: "EamilOS",
        type: "feature",
        riskLevel: "moderate",
        downloads: 0,
        rating: 0,
        source: "eamilos-plugin-parallel",
        tags: ["performance", "reliability", "multi-model"]
      },
      {
        id: "self-healing-routing",
        name: "Self-Healing Routing",
        description: "Automatically blacklist failing models",
        version: "1.0.0",
        author: "EamilOS",
        type: "feature",
        riskLevel: "safe",
        downloads: 0,
        rating: 0,
        source: "eamilos-plugin-self-healing",
        tags: ["reliability", "routing", "auto-recovery"]
      },
      {
        id: "adaptive-prompting",
        name: "Adaptive Prompting",
        description: "Tune prompts automatically per model",
        version: "1.0.0",
        author: "EamilOS",
        type: "feature",
        riskLevel: "safe",
        downloads: 0,
        rating: 0,
        source: "eamilos-plugin-adaptive-prompting",
        tags: ["prompting", "optimization", "per-model"]
      }
    ];
  }
}
