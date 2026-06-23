import { Feature, FeatureContext, FeatureStatus } from './types.js';

interface BlacklistEntry {
  modelId: string;
  category: string;
  failureCount: number;
  blacklistedAt: number;
  expiresAt: number;
  reasons: string[];
}

export class SelfHealingRoutingFeature implements Feature {
  readonly id = 'self_healing_routing';
  readonly name = 'Self-Healing Routing';
  readonly description = 'Automatically blacklists failing models and restores them after cooldown';
  enabled = false;

  private config = {
    failureThreshold: 3,
    cooldownMinutes: 30,
    resetOnSuccess: true,
    trackPerCategory: true,
    maxBlacklistedRatio: 0.5,
    emitEvents: true,
  };

  private failureCounters: Map<string, number> = new Map();
  private blacklist: Map<string, BlacklistEntry> = new Map();
  private eventListeners: Map<string, Array<(data: any) => void>> = new Map();

  private stats = {
    totalBlacklists: 0,
    totalRestorations: 0,
    currentBlacklisted: 0,
    failuresPreventedByBlacklist: 0,
  };
  private errors: string[] = [];

  async initialize(config: Record<string, unknown>): Promise<void> {
    this.config.failureThreshold = (config.failure_threshold as number) || 3;
    this.config.cooldownMinutes = (config.cooldown_minutes as number) || 30;
    this.config.resetOnSuccess = config.reset_on_success !== false;
    this.config.trackPerCategory = config.track_per_category !== false;
    this.config.maxBlacklistedRatio = (config.max_blacklisted as number) || 0.5;
    this.config.emitEvents = config.emit_events !== false;
  }

  getStatus(): FeatureStatus {
    this.cleanExpiredBlacklist();

    return {
      id: this.id,
      enabled: this.enabled,
      initialized: true,
      health: 'healthy',
      stats: {
        totalBlacklists: this.stats.totalBlacklists,
        totalRestorations: this.stats.totalRestorations,
        currentBlacklisted: this.blacklist.size,
        failuresPrevented: this.stats.failuresPreventedByBlacklist,
        blacklistedModels: Array.from(new Set(
          Array.from(this.blacklist.values()).map(e => e.modelId)
        )).join(', ') || 'none'
      },
      lastActivity: new Date().toISOString(),
      errors: this.errors.slice(-10)
    };
  }

  async afterModelSelection(ctx: FeatureContext): Promise<void> {
    this.cleanExpiredBlacklist();

    if (this.isBlacklisted(ctx.selectedModel.modelId, ctx.taskCategory)) {
      this.stats.failuresPreventedByBlacklist++;

      const replacement = ctx.alternateModels.find(
        m => !this.isBlacklisted(m.modelId, ctx.taskCategory)
      );

      if (replacement) {
        const original = ctx.selectedModel;
        ctx.selectedModel = replacement;
        ctx.alternateModels = ctx.alternateModels.filter(m => m.modelId !== replacement.modelId);

        ctx.featureData.set('self_healing:original_model', original.modelId);
        ctx.featureData.set('self_healing:replacement_model', replacement.modelId);
        ctx.featureData.set('self_healing:reason', 'Model blacklisted due to consecutive failures');
      }
    }

    ctx.alternateModels = ctx.alternateModels.filter(
      m => !this.isBlacklisted(m.modelId, ctx.taskCategory)
    );
  }

  async afterExecution(ctx: FeatureContext): Promise<void> {
    if (!ctx.executionResult) return;

    const modelId = ctx.selectedModel.modelId;
    const category = ctx.taskCategory;
    const key = this.getKey(modelId, category);

    if (ctx.executionResult.success) {
      if (this.config.resetOnSuccess) {
        this.failureCounters.delete(key);
        if (this.config.trackPerCategory) {
          this.failureCounters.delete(this.getKey(modelId, 'all'));
        }
      }
    } else {
      const currentCount = (this.failureCounters.get(key) || 0) + 1;
      this.failureCounters.set(key, currentCount);

      const allKey = this.getKey(modelId, 'all');
      const allCount = (this.failureCounters.get(allKey) || 0) + 1;
      this.failureCounters.set(allKey, allCount);

      if (currentCount >= this.config.failureThreshold) {
        this.blacklistModel(
          modelId,
          category,
          currentCount,
          ctx.executionResult.failureReason || 'consecutive failures',
          ctx.availableModels.length
        );
      }
    }
  }

  private blacklistModel(
    modelId: string,
    category: string,
    failureCount: number,
    reason: string,
    totalAvailableModels: number
  ): void {
    const currentBlacklistedCount = new Set(
      Array.from(this.blacklist.values()).map(e => e.modelId)
    ).size;

    if (currentBlacklistedCount / Math.max(totalAvailableModels, 1) >= this.config.maxBlacklistedRatio) {
      return;
    }

    const key = this.getKey(modelId, category);
    const cooldownMs = this.config.cooldownMinutes * 60 * 1000;
    const now = Date.now();

    const entry: BlacklistEntry = {
      modelId,
      category: this.config.trackPerCategory ? category : 'all',
      failureCount,
      blacklistedAt: now,
      expiresAt: now + cooldownMs,
      reasons: [reason]
    };

    this.blacklist.set(key, entry);
    this.stats.totalBlacklists++;
    this.stats.currentBlacklisted = this.blacklist.size;

    if (this.config.emitEvents) {
      this.emit('model.blacklisted', {
        modelId,
        category,
        failureCount,
        cooldownMinutes: this.config.cooldownMinutes,
        expiresAt: new Date(entry.expiresAt).toISOString()
      });
    }
  }

  private isBlacklisted(modelId: string, category: string): boolean {
    const categoryKey = this.getKey(modelId, category);
    if (this.blacklist.has(categoryKey)) {
      const entry = this.blacklist.get(categoryKey)!;
      if (Date.now() < entry.expiresAt) return true;
      this.blacklist.delete(categoryKey);
      this.stats.totalRestorations++;
      if (this.config.emitEvents) {
        this.emit('model.restored', { modelId, category });
      }
    }

    const allKey = this.getKey(modelId, 'all');
    if (this.blacklist.has(allKey)) {
      const entry = this.blacklist.get(allKey)!;
      if (Date.now() < entry.expiresAt) return true;
      this.blacklist.delete(allKey);
      this.stats.totalRestorations++;
      if (this.config.emitEvents) {
        this.emit('model.restored', { modelId, category: 'all' });
      }
    }

    return false;
  }

  private cleanExpiredBlacklist(): void {
    const now = Date.now();
    for (const [key, entry] of this.blacklist) {
      if (now >= entry.expiresAt) {
        this.blacklist.delete(key);
        this.stats.totalRestorations++;
        if (this.config.emitEvents) {
          this.emit('model.restored', {
            modelId: entry.modelId,
            category: entry.category
          });
        }
      }
    }
    this.stats.currentBlacklisted = this.blacklist.size;
  }

  private getKey(modelId: string, category: string): string {
    return this.config.trackPerCategory
      ? `${modelId}::${category}`
      : `${modelId}::all`;
  }

  on(event: string, listener: (data: any) => void): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    this.eventListeners.get(event)!.push(listener);
  }

  private emit(event: string, data: any): void {
    const listeners = this.eventListeners.get(event) || [];
    for (const listener of listeners) {
      try { listener(data); } catch { }
    }
  }
}
