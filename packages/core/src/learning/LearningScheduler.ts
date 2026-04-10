export type LearningPhase = 'model' | 'strategy' | 'prompt' | 'parameters';
export type LearningComponent = 'model' | 'strategy' | 'prompt' | 'parameters' | 'all';

export interface LearningScheduleConfig {
  cycleLength: number;
  enabled: boolean;
  minExecutionsBeforeStart: number;
  freezeOnInstability: boolean;
  instabilityThreshold: number;
}

export const DEFAULT_SCHEDULE_CONFIG: LearningScheduleConfig = {
  cycleLength: 4,
  enabled: true,
  minExecutionsBeforeStart: 10,
  freezeOnInstability: true,
  instabilityThreshold: 0.3,
};

export class LearningScheduler {
  private config: LearningScheduleConfig;
  private executionCount: number = 0;
  private frozen: boolean = false;
  private frozenReason?: string;
  private oscillationHistory: number[] = [];
  private readonly oscillationWindow = 20;

  constructor(config: Partial<LearningScheduleConfig> = {}) {
    this.config = { ...DEFAULT_SCHEDULE_CONFIG, ...config };
  }

  recordExecution(success: boolean): void {
    this.executionCount++;
    this.oscillationHistory.push(success ? 1 : 0);

    if (this.oscillationHistory.length > this.oscillationWindow) {
      this.oscillationHistory.shift();
    }

    if (this.config.freezeOnInstability) {
      this.checkInstability();
    }
  }

  private checkInstability(): void {
    if (this.oscillationHistory.length < 10) {
      return;
    }

    const recent = this.oscillationHistory.slice(-10);
    const flips = this.countFlips(recent);

    if (flips >= 6) {
      this.freeze('Oscillation detected: frequent success/failure flips');
    }
  }

  private countFlips(values: number[]): number {
    let flips = 0;
    for (let i = 1; i < values.length; i++) {
      if (values[i] !== values[i - 1]) {
        flips++;
      }
    }
    return flips;
  }

  freeze(reason: string): void {
    this.frozen = true;
    this.frozenReason = reason;
  }

  unfreeze(): void {
    this.frozen = false;
    this.frozenReason = undefined;
    this.oscillationHistory = [];
  }

  isFrozen(): boolean {
    return this.frozen;
  }

  getFreezeReason(): string | undefined {
    return this.frozenReason;
  }

  getCurrentPhase(): LearningPhase {
    if (this.executionCount <= this.config.minExecutionsBeforeStart) {
      return 'model';
    }

    if (this.frozen) {
      return 'model';
    }

    return this.getPhaseForCount(this.executionCount - this.config.minExecutionsBeforeStart);
  }

  private getPhaseForCount(phaseCount: number): LearningPhase {
    const phaseIndex = phaseCount % this.config.cycleLength;
    const phases: LearningPhase[] = ['model', 'strategy', 'prompt', 'parameters'];
    return phases[phaseIndex];
  }

  shouldUpdate(component: LearningComponent): boolean {
    if (!this.config.enabled) {
      return false;
    }

    if (this.frozen) {
      return false;
    }

    if (this.executionCount < this.config.minExecutionsBeforeStart) {
      return component === 'model';
    }

    const currentPhase = this.getCurrentPhase();

    if (component === 'all') {
      return true;
    }

    return component === currentPhase;
  }

  getUpdateOrder(): LearningComponent[] {
    if (this.frozen) {
      return [];
    }

    const currentPhase = this.getCurrentPhase();
    const allComponents: LearningComponent[] = ['model', 'strategy', 'prompt', 'parameters'];

    const currentIndex = allComponents.indexOf(currentPhase);
    const ordered: LearningComponent[] = [
      currentPhase,
      ...allComponents.slice(0, currentIndex),
      ...allComponents.slice(currentIndex + 1),
    ];

    return ordered;
  }

  getExecutionCount(): number {
    return this.executionCount;
  }

  getNextPhase(): LearningPhase {
    const nextCount = this.executionCount + 1;
    if (nextCount < this.config.minExecutionsBeforeStart) {
      return 'model';
    }
    return this.getPhaseForCount(nextCount);
  }

  getScheduleStatus(): LearningScheduleStatus {
    return {
      enabled: this.config.enabled,
      frozen: this.frozen,
      frozenReason: this.frozenReason,
      executionCount: this.executionCount,
      currentPhase: this.getCurrentPhase(),
      nextPhase: this.getNextPhase(),
      minExecutionsBeforeStart: this.config.minExecutionsBeforeStart,
      ready: this.executionCount >= this.config.minExecutionsBeforeStart && !this.frozen,
    };
  }

  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
  }

  reset(): void {
    this.executionCount = 0;
    this.frozen = false;
    this.frozenReason = undefined;
    this.oscillationHistory = [];
  }
}

export interface LearningScheduleStatus {
  enabled: boolean;
  frozen: boolean;
  frozenReason?: string;
  executionCount: number;
  currentPhase: LearningPhase;
  nextPhase: LearningPhase;
  minExecutionsBeforeStart: number;
  ready: boolean;
}
