import type { ExecutionRecord, FeedbackReport, Action, ErrorRecord } from './types.js';
import { ExecutionMemory } from './ExecutionMemory.js';
import { ModelPerformance } from './ModelPerformance.js';
import { SmartModelRouter } from './SmartModelRouter.js';
import { StrategyOptimizer } from './StrategyOptimizer.js';
import { PromptOptimizer } from './PromptOptimizer.js';
import { FailureAnalyzer } from './FailureAnalyzer.js';
import { AutoTuner } from './AutoTuner.js';
import { CausalAttribution, InteractionMatrix, LearningScheduler, ActionValidator } from './index.js';
import * as fs from 'fs';
import * as path from 'path';

export interface FeedbackLoopConfig {
  storagePath: string;
  enableAutoApply: boolean;
  maxAutoApplyDuration: number;
  minConfidenceForAutoApply: number;
  enableCausalAttribution: boolean;
  enableStaggeredUpdates: boolean;
  enableInteractionMatrix: boolean;
}

export const DEFAULT_FEEDBACK_LOOP_CONFIG: FeedbackLoopConfig = {
  storagePath: '.eamilos/learning',
  enableAutoApply: true,
  maxAutoApplyDuration: 30 * 60 * 1000,
  minConfidenceForAutoApply: 0.7,
  enableCausalAttribution: true,
  enableStaggeredUpdates: true,
  enableInteractionMatrix: true,
};

export class FeedbackLoop {
  private config: FeedbackLoopConfig;
  private executionMemory: ExecutionMemory;
  private modelPerformance: ModelPerformance;
  private modelRouter: SmartModelRouter;
  private strategyOptimizer: StrategyOptimizer;
  private promptOptimizer: PromptOptimizer;
  private failureAnalyzer: FailureAnalyzer;
  private autoTuner: AutoTuner;
  private causalAttribution: CausalAttribution;
  private interactionMatrix: InteractionMatrix;
  private learningScheduler: LearningScheduler;
  private actionValidator: ActionValidator;
  private appliedActions: AppliedAction[] = [];
  private recentReports: FeedbackReport[] = [];
  private isInitialized: boolean = false;
  private previousRecord: ExecutionRecord | null = null;

  constructor(
    config: Partial<FeedbackLoopConfig> = {},
    executionMemory?: ExecutionMemory,
    modelPerformance?: ModelPerformance,
    modelRouter?: SmartModelRouter,
    strategyOptimizer?: StrategyOptimizer,
    promptOptimizer?: PromptOptimizer,
    failureAnalyzer?: FailureAnalyzer,
    autoTuner?: AutoTuner,
    causalAttribution?: CausalAttribution,
    interactionMatrix?: InteractionMatrix,
    learningScheduler?: LearningScheduler,
    actionValidator?: ActionValidator
  ) {
    this.config = { ...DEFAULT_FEEDBACK_LOOP_CONFIG, ...config };

    this.executionMemory = executionMemory || new ExecutionMemory({
      dataDir: this.config.storagePath,
    });

    this.modelPerformance = modelPerformance || new ModelPerformance();
    this.modelRouter = modelRouter || new SmartModelRouter({}, this.modelPerformance);
    this.strategyOptimizer = strategyOptimizer || new StrategyOptimizer();
    this.promptOptimizer = promptOptimizer || new PromptOptimizer();
    this.failureAnalyzer = failureAnalyzer || new FailureAnalyzer();
    this.autoTuner = autoTuner || new AutoTuner();
    this.causalAttribution = causalAttribution || new CausalAttribution();
    this.interactionMatrix = interactionMatrix || new InteractionMatrix();
    this.learningScheduler = learningScheduler || new LearningScheduler();
    this.actionValidator = actionValidator || new ActionValidator();
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    await this.executionMemory.initialize();
    this.promptOptimizer.initialize();
    this.isInitialized = true;

    this.loadAppliedActions();
  }

  async shutdown(): Promise<void> {
    this.promptOptimizer.shutdown();
    await this.executionMemory.shutdown();
    this.saveAppliedActions();
  }

  async processExecution(record: ExecutionRecord): Promise<FeedbackReport> {
    const startTime = Date.now();
    const actions: Array<Action & { applied: boolean; source: string; reason?: string }> = [];

    this.learningScheduler.recordExecution(record.success);

    await this.executionMemory.record(record);

    const changedComponents = this.detectChangedComponents(record);

    let attribution = { model: 0.4, strategy: 0.3, prompt: 0.2, parameters: 0.1, confidence: 0 };
    if (this.config.enableCausalAttribution && this.previousRecord) {
      attribution = this.causalAttribution.computeAttribution(record, changedComponents);
    }

    if (this.config.enableStaggeredUpdates) {
      this.applyStaggeredUpdates(record, attribution);
    } else {
      this.applyAllUpdates(record, attribution);
    }

    if (this.config.enableInteractionMatrix && record.agentsUsed.length > 1) {
      this.updateInteractionMatrix(record);
    }

    for (const error of record.errors) {
      const signature = this.computeErrorSignature(error);
      this.failureAnalyzer.recordFailure(error.errorType, signature, record);
    }

    const failureActions = this.failureAnalyzer.getReport().recommendations;
    const tunerState = this.autoTuner.getState();

    if (this.config.enableAutoApply) {
      for (const action of failureActions) {
        if (this.isSafeToAutoApply(action)) {
          this.actionValidator.startValidation(action);
          await this.applyAction(action);
          actions.push({ ...action, applied: true, source: 'failure-analyzer' });
        } else {
          actions.push({ ...action, applied: false, source: 'failure-analyzer', reason: 'requires operator approval' });
        }
      }
    } else {
      for (const action of failureActions) {
        actions.push({ ...action, applied: false, source: 'failure-analyzer', reason: 'auto-apply disabled' });
      }
    }

    this.previousRecord = record;

    const report: FeedbackReport = {
      executionId: record.id,
      processingTimeMs: Date.now() - startTime,
      modelUpdates: this.getRecentModelChanges(),
      strategyInsights: this.getRecentStrategyInsights(),
      promptEvolutions: this.getRecentPromptEvolutions(),
      failurePatternsDetected: this.failureAnalyzer.getReport(),
      parameterAdjustments: tunerState,
      actionsApplied: actions.filter(a => a.applied),
      actionsPending: actions.filter(a => !a.applied),
      systemMetrics: this.getSystemMetrics(),
    };

    this.recentReports.push(report);
    if (this.recentReports.length > 100) {
      this.recentReports.shift();
    }

    return report;
  }

  private detectChangedComponents(record: ExecutionRecord): { model: string[]; strategy: string | null; prompt: string[]; parameters: string[] } {
    const model: string[] = [];
    const prompt: string[] = [];

    for (const agent of record.agentsUsed) {
      model.push(agent.model);
    }

    for (const variant of record.promptVariantsUsed) {
      prompt.push(variant.variantId);
    }

    return {
      model,
      strategy: record.strategy,
      prompt,
      parameters: [],
    };
  }

  private applyStaggeredUpdates(record: ExecutionRecord, attribution: { model: number; strategy: number; prompt: number; parameters: number; confidence: number }): void {
    const currentPhase = this.learningScheduler.getCurrentPhase();

    this.modelPerformance.recordExecution(record);
    for (const agent of record.agentsUsed) {
      this.modelRouter.updateReward(agent.model, record, record.agentsUsed.indexOf(agent));
    }

    if (attribution.confidence < 0.3) {
      return;
    }

    switch (currentPhase) {
      case 'model':
        break;

      case 'strategy':
        this.strategyOptimizer.recordExecution(record);
        break;

      case 'prompt':
        this.promptOptimizer.recordExecution(record);
        break;

      case 'parameters':
        this.autoTuner.recordObservation(record);
        break;
    }
  }

  private applyAllUpdates(record: ExecutionRecord, attribution: { model: number; strategy: number; prompt: number; parameters: number; confidence: number }): void {
    this.modelPerformance.recordExecution(record);
    for (const agent of record.agentsUsed) {
      this.modelRouter.updateReward(agent.model, record, record.agentsUsed.indexOf(agent));
    }

    if (attribution.confidence >= 0.3) {
      this.strategyOptimizer.recordExecution(record);
      this.promptOptimizer.recordExecution(record);
      this.autoTuner.recordObservation(record);
    }
  }

  private updateInteractionMatrix(record: ExecutionRecord): void {
    const agents = record.agentsUsed;
    for (let i = 0; i < agents.length - 1; i++) {
      for (let j = i + 1; j < agents.length; j++) {
        this.interactionMatrix.recordInteraction(
          agents[i].role,
          agents[j].role,
          record.success,
          { latencyMs: record.totalLatencyMs }
        );
      }
    }
  }

  private computeErrorSignature(error: ErrorRecord): string {
    return error.errorMessage
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<UUID>')
      .replace(/\d{10,13}/g, '<TIMESTAMP>')
      .replace(/\d+\.\d+\.\d+\.\d+/g, '<IP>')
      .replace(/"[^"]{50,}"/g, '"<LONG_STRING>"')
      .replace(/\b\d+\b/g, '<N>')
      .trim()
      .toLowerCase()
      .substring(0, 100);
  }

  private isSafeToAutoApply(action: Action): boolean {
    switch (action.type) {
      case 'adjust-timeout':
        return action.multiplier >= 0.5 && action.multiplier <= 3.0;
      case 'enrich-prompt':
        return true;
      case 'avoid-model':
        return action.duration <= this.config.maxAutoApplyDuration;
      case 'switch-strategy':
        return false;
      case 'add-agent-role':
        return false;
      case 'alert-operator':
        return true;
      default:
        return false;
    }
  }

  private async applyAction(action: Action): Promise<void> {
    switch (action.type) {
      case 'adjust-timeout':
        this.autoTuner.adjustParameter('agentTimeoutMs', action.multiplier);
        break;
      case 'avoid-model':
        this.modelRouter.unregisterModel(action.model);
        setTimeout(() => {
          this.modelRouter.registerModel(action.model);
        }, action.duration);
        break;
      case 'enrich-prompt':
        break;
      case 'alert-operator':
        console.log(`[ALERT] ${action.severity.toUpperCase()}: ${action.message}`);
        break;
    }

    const appliedAction: AppliedAction = {
      id: `action_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      action,
      timestamp: Date.now(),
      reason: this.getActionReason(action),
    };

    this.appliedActions.push(appliedAction);
    this.saveAppliedActions();
  }

  private getActionReason(action: Action): string {
    switch (action.type) {
      case 'adjust-timeout':
        return action.reason;
      case 'avoid-model':
        return `Model ${action.model}: ${action.reason}`;
      case 'enrich-prompt':
        return `Enrichment: ${action.enrichment} - ${action.reason}`;
      case 'switch-strategy':
        return `Strategy ${action.from} → ${action.to}: ${action.reason}`;
      case 'add-agent-role':
        return `Added role ${action.role}: ${action.reason}`;
      case 'alert-operator':
        return action.message;
      default:
        return 'Unknown action';
    }
  }

  private getRecentModelChanges(): Array<{ modelId: string; change: string; timestamp: number }> {
    const snapshot = this.modelPerformance.getSnapshot();
    return snapshot.models.slice(0, 5).map(m => ({
      modelId: m.modelId,
      change: `Success rate: ${(m.successRate * 100).toFixed(1)}%`,
      timestamp: m.lastUpdated,
    }));
  }

  private getRecentStrategyInsights(): Array<{ strategy: string; insight: string }> {
    const insights: Array<{ strategy: string; insight: string }> = [];
    const stats = this.strategyOptimizer.getStrategyStats();

    for (const [strategy, stat] of stats) {
      if (stat.sampleSize > 0) {
        insights.push({
          strategy,
          insight: `${(stat.successRate * 100).toFixed(1)}% success (${stat.sampleSize} samples)`,
        });
      }
    }

    return insights;
  }

  private getRecentPromptEvolutions(): Array<{ baseHash: string; variantCount: number; bestRate: number }> {
    const stats = this.promptOptimizer.getStatistics();
    return [{
      baseHash: 'prompts',
      variantCount: stats.totalVariants,
      bestRate: stats.averageSuccessRate,
    }];
  }

  private getSystemMetrics(): {
    totalExecutions: number;
    overallSuccessRate: number;
    successTrend: string;
    avgLatencyTrend: string;
    avgCostTrend: string;
  } {
    const memoryStats = this.executionMemory.getStats();
    const snapshot = this.modelPerformance.getSnapshot();

    return {
      totalExecutions: snapshot.totalExecutions,
      overallSuccessRate: memoryStats.successRate,
      successTrend: this.computeTrend(),
      avgLatencyTrend: 'stable',
      avgCostTrend: 'stable',
    };
  }

  private computeTrend(): string {
    if (this.recentReports.length < 10) return 'insufficient_data';

    const recentRates = this.recentReports.slice(-20).map(r => r.systemMetrics.overallSuccessRate);
    if (recentRates.length < 5) return 'stable';

    const recentAvg = recentRates.slice(-5).reduce((a, b) => a + b, 0) / 5;
    const olderAvg = recentRates.slice(0, 5).reduce((a, b) => a + b, 0) / 5;

    if (recentAvg > olderAvg + 0.05) return 'improving';
    if (recentAvg < olderAvg - 0.05) return 'degrading';
    return 'stable';
  }

  getInsights(): LearningInsights {
    const memoryStats = this.executionMemory.getStats();
    const snapshot = this.modelPerformance.getSnapshot();
    const failureReport = this.failureAnalyzer.getReport();
    const tunerState = this.autoTuner.getState();
    const promptStats = this.promptOptimizer.getStatistics();

    return {
      systemOverview: {
        totalExecutions: snapshot.totalExecutions,
        overallSuccessRate: memoryStats.successRate,
        avgLatencyMs: memoryStats.avgLatencyMs,
        avgCostUSD: memoryStats.avgCostUSD,
        learningActive: true,
        lastUpdated: Date.now(),
      },
      modelRankings: snapshot.models
        .sort((a, b) => b.overallScore - a.overallScore)
        .slice(0, 10)
        .map(m => ({
          modelId: m.modelId,
          successRate: m.successRate,
          successRateCI: m.successRateCI,
          avgLatencyMs: m.avgLatencyMs,
          avgCostUSD: m.avgCostUSD,
          reliabilityScore: m.reliabilityScore,
          overallScore: m.overallScore,
          sampleSize: m.sampleSize,
          trend: m.successTrend.direction,
        })),
      strategyPerformance: Array.from(this.strategyOptimizer.getStrategyStats().entries()).map(([strategy, stats]) => ({
        strategy,
        successRate: stats.successRate,
        successRateCI: stats.successRateCI,
        avgLatencyMs: stats.avgLatencyMs,
        avgCostUSD: stats.avgCostUSD,
        sampleSize: stats.sampleSize,
        trend: stats.trend,
      })),
      failurePatterns: {
        totalPatterns: failureReport.totalPatternsDetected,
        activePatterns: failureReport.activePatternsCount,
        systematic: failureReport.systematicPatterns.length,
        frequent: failureReport.frequentPatterns.length,
        topModels: failureReport.topModelsWithFailures.slice(0, 5),
      },
      promptEvolution: {
        totalBasePrompts: promptStats.totalBasePrompts,
        totalVariants: promptStats.totalVariants,
        activeVariants: promptStats.activeVariants,
        averageSuccessRate: promptStats.averageSuccessRate,
      },
      autoTuning: tunerState as unknown as Record<string, unknown>,
      recommendations: this.generateRecommendations(snapshot, failureReport, tunerState),
    };
  }

  private generateRecommendations(
    snapshot: ReturnType<typeof this.modelPerformance.getSnapshot>,
    failureReport: ReturnType<typeof this.failureAnalyzer.getReport>,
    tunerState: ReturnType<typeof this.autoTuner.getState>
  ): string[] {
    const recommendations: string[] = [];

    const lowSuccessModels = snapshot.models.filter(m => m.successRate < 0.7);
    if (lowSuccessModels.length > 0) {
      recommendations.push(
        `${lowSuccessModels.length} model(s) have success rate below 70%: ${lowSuccessModels.map(m => m.modelId).join(', ')}`
      );
    }

    if (failureReport.systematicPatterns.length > 0) {
      recommendations.push(
        `${failureReport.systematicPatterns.length} systematic failure pattern(s) detected - investigate ASAP`
      );
    }

    const degradingModels = snapshot.models.filter(m => m.successTrend.direction === 'declining');
    if (degradingModels.length > 0) {
      recommendations.push(
        `Models with degrading performance: ${degradingModels.map(m => m.modelId).join(', ')}`
      );
    }

    const tunedParams = Object.entries(tunerState).filter((entry) => {
      const v = entry[1] as { direction?: string };
      return v && v.direction !== 'hold';
    });
    if (tunedParams.length > 0) {
      recommendations.push(
        `${tunedParams.length} parameter(s) auto-tuned: ${tunedParams.map(([k, v]) => {
          const state = v as { direction?: string };
          return `${k} (${state.direction})`;
        }).join(', ')}`
      );
    }

    if (recommendations.length === 0) {
      recommendations.push('System performing well - no critical recommendations');
    }

    return recommendations;
  }

  explainRouting(params: {
    role?: string;
    taskType?: string;
    complexity?: string;
    model?: string;
  }): string {
    const lines: string[] = [];

    lines.push('═══ EamilOS Routing Explanation ═══');
    lines.push('');

    if (params.model) {
      const metrics = this.modelPerformance.getGlobalMetrics(params.model);
      if (metrics) {
        lines.push(`Model: ${params.model}`);
        lines.push(`  Overall Score: ${(metrics.overallScore * 100).toFixed(1)}%`);
        lines.push(`  Success Rate: ${(metrics.successRate * 100).toFixed(1)}%`);
        lines.push(`  Reliability Score: ${(metrics.reliabilityScore * 100).toFixed(1)}%`);
        lines.push(`  Avg Latency: ${metrics.avgLatencyMs.toFixed(0)}ms`);
        lines.push(`  Avg Cost: $${metrics.avgCostUSD.toFixed(4)}`);
        lines.push(`  Sample Size: ${metrics.sampleSize}`);
        lines.push(`  Trend: ${metrics.successTrend.direction}`);
        lines.push('');
      }

      const recommendations = this.modelPerformance.getRecommendation(params.model);
      lines.push(`Recommendation: ${recommendations}`);
    }

    const routerStats = this.modelRouter.getStatistics();
    lines.push('');
    lines.push('Router Statistics:');
    lines.push(`  Registered Models: ${routerStats.modelCount}`);
    lines.push(`  Exploration Rate: ${(routerStats.explorationRate * 100).toFixed(1)}%`);

    return lines.join('\n');
  }

  getLearningConfig(): LearningConfigState {
    return {
      enabled: this.config.enableAutoApply,
      storagePath: this.config.storagePath,
      autoApplyEnabled: this.config.enableAutoApply,
      maxAutoApplyDuration: this.config.maxAutoApplyDuration,
      appliedActions: this.appliedActions.slice(-20),
    };
  }

  updateLearningConfig(updates: Partial<FeedbackLoopConfig>): void {
    this.config = { ...this.config, ...updates };
    this.saveConfig();
  }

  resetLearning(): void {
    this.appliedActions = [];
    this.recentReports = [];
    this.saveAppliedActions();
  }

  recordSimpleExecution(record: SimpleExecutionRecord): void {
    this.modelPerformance.recordSimpleExecution({
      modelId: record.modelId,
      success: record.success,
      latencyMs: record.latencyMs,
      costUSD: record.costUsd,
      tokensIn: record.inputTokens,
      tokensOut: record.outputTokens,
    });

    this.modelRouter.registerModel(record.modelId);
    this.modelRouter.updateReward(
      record.modelId,
      {
        id: record.taskId,
        timestamp: Date.now(),
        sessionId: record.projectId,
        goal: record.taskInput,
        taskType: 'general' as any,
        taskComplexity: 'medium',
        taskDomains: [],
        strategy: 'direct' as any,
        agentsUsed: [{
          agentId: record.providerId,
          role: 'general' as any,
          model: record.modelId,
          tokensIn: record.inputTokens,
          tokensOut: record.outputTokens,
          costUSD: record.costUsd,
          latencyMs: record.latencyMs,
          success: record.success,
          retries: 0,
        }],
        modelsUsed: [record.modelId],
        controlMode: 'auto',
        success: record.success,
        partialSuccess: false,
        subtaskResults: [],
        totalLatencyMs: record.latencyMs,
        totalTokensIn: record.inputTokens,
        totalTokensOut: record.outputTokens,
        totalCostUSD: record.costUsd,
        tickCount: 1,
        retryCount: 0,
        failureCount: record.success ? 0 : 1,
        healingActions: [],
        modelSwaps: [],
        strategyAdaptations: [],
        errors: record.success ? [] : [{
          agentId: record.providerId,
          model: record.modelId,
          errorType: 'unknown',
          errorMessage: 'Execution failed',
          timestamp: Date.now(),
          resolved: false,
        }],
        promptVariantsUsed: [],
      },
      0
    );
  }

  private loadAppliedActions(): void {
    const actionsPath = path.join(this.config.storagePath, 'applied_actions.json');
    try {
      if (fs.existsSync(actionsPath)) {
        const data = fs.readFileSync(actionsPath, 'utf-8');
        this.appliedActions = JSON.parse(data);
      }
    } catch {
      this.appliedActions = [];
    }
  }

  private saveAppliedActions(): void {
    const actionsPath = path.join(this.config.storagePath, 'applied_actions.json');
    try {
      const dir = path.dirname(actionsPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(actionsPath, JSON.stringify(this.appliedActions, null, 2));
    } catch {
      // Silently fail
    }
  }

  private saveConfig(): void {
    const configPath = path.join(this.config.storagePath, 'feedback_loop_config.json');
    try {
      const dir = path.dirname(configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(configPath, JSON.stringify(this.config, null, 2));
    } catch {
      // Silently fail
    }
  }

  exportData(): string {
    return JSON.stringify({
      timestamp: Date.now(),
      insights: this.getInsights(),
      config: this.getLearningConfig(),
      appliedActions: this.appliedActions,
    }, null, 2);
  }

  async importData(jsonData: string): Promise<number> {
    try {
      const data = JSON.parse(jsonData);
      let imported = 0;

      if (data.appliedActions && Array.isArray(data.appliedActions)) {
        this.appliedActions = data.appliedActions;
        imported++;
      }

      this.saveAppliedActions();
      return imported;
    } catch {
      return 0;
    }
  }
}

interface AppliedAction {
  id: string;
  action: Action;
  timestamp: number;
  reason: string;
}

export interface LearningInsights {
  systemOverview: {
    totalExecutions: number;
    overallSuccessRate: number;
    avgLatencyMs: number;
    avgCostUSD: number;
    learningActive: boolean;
    lastUpdated: number;
  };
  modelRankings: Array<{
    modelId: string;
    successRate: number;
    successRateCI: { lower: number; upper: number };
    avgLatencyMs: number;
    avgCostUSD: number;
    reliabilityScore: number;
    overallScore: number;
    sampleSize: number;
    trend: string;
  }>;
  strategyPerformance: Array<{
    strategy: string;
    successRate: number;
    successRateCI: [number, number];
    avgLatencyMs: number;
    avgCostUSD: number;
    sampleSize: number;
    trend: string;
  }>;
  failurePatterns: {
    totalPatterns: number;
    activePatterns: number;
    systematic: number;
    frequent: number;
    topModels: Array<{ model: string; count: number }>;
  };
  promptEvolution: {
    totalBasePrompts: number;
    totalVariants: number;
    activeVariants: number;
    averageSuccessRate: number;
  };
  autoTuning: Record<string, unknown>;
  recommendations: string[];
}

export interface LearningConfigState {
  enabled: boolean;
  storagePath: string;
  autoApplyEnabled: boolean;
  maxAutoApplyDuration: number;
  appliedActions: AppliedAction[];
}

export interface SimpleExecutionRecord {
  modelId: string;
  providerId: string;
  success: boolean;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
  taskInput: string;
  projectId: string;
  taskId: string;
}

let globalFeedbackLoop: FeedbackLoop | null = null;

export function initFeedbackLoop(config?: Partial<FeedbackLoopConfig>): FeedbackLoop {
  globalFeedbackLoop = new FeedbackLoop(config);
  void globalFeedbackLoop.initialize();
  return globalFeedbackLoop;
}

export function getFeedbackLoop(): FeedbackLoop | null {
  return globalFeedbackLoop;
}
