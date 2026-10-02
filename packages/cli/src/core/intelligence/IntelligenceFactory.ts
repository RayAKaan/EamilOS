import { CoordinationEngine } from '../coordination/CoordinationEngine.js';
import { MissionEngine } from '../mission/MissionEngine.js';
import { ExecutionStore } from '../execution/ExecutionStore.js';
import { HarnessRegistry } from '../execution/HarnessRegistry.js';
import { DeterministicJevProvider } from './DeterministicJevProvider.js';
import { HarnessScheduler } from '../execution/HarnessScheduler.js';
import { JevHttpProvider } from './JevHttpProvider.js';
import { LayaProcessAdapter } from './LayaProcessAdapter.js';
import { MockJevProvider } from './providers/MockJevProvider.js';
import { FallbackLayaAdapter } from './providers/FallbackLayaAdapter.js';
import { LayaHttpDecisionAdapter } from './LayaHttpDecisionAdapter.js';
import { LayaProcessDecisionAdapter } from './LayaProcessDecisionAdapter.js';
import type { LayaCalibrationConfig } from './LayaDecisionTypes.js';
import type { IntelligenceConfig, JevProvider, LayaModelAdapter } from './types.js';
import { IntelligenceEngine, defaultIntelligenceConfig } from './IntelligenceEngine.js';

export interface IntelligenceRuntimeOptions {
  missions?: MissionEngine;
  coordination?: CoordinationEngine;
  registry?: HarnessRegistry;
  jev?: JevProvider;
  laya?: LayaModelAdapter;
  layaTyped?: import('./LayaDecisionTypes.js').LayaDecisionAdapter;
  layaCalibration?: LayaCalibrationConfig;
  config?: IntelligenceConfig;
  executions?: ExecutionStore;
}

export function createIntelligenceRuntime(options: IntelligenceRuntimeOptions = {}): IntelligenceEngine {
  const missions = options.missions ?? new MissionEngine();
  const coordination = options.coordination ?? new CoordinationEngine(missions);
  const registry = options.registry ?? new HarnessRegistry();
  const scheduler = new HarnessScheduler(missions, coordination, registry);
  const config = options.config ?? defaultIntelligenceConfig();
  const jev = options.jev ?? createJevFromEnvironment(config);
  const laya = options.laya ?? createLayaFromEnvironment(config);
  const layaTyped = options.layaTyped ?? createLayaTypedFromEnvironment(config);
  return new IntelligenceEngine(missions, coordination, scheduler, jev, laya, config, undefined, undefined, options.executions, registry, layaTyped, options.layaCalibration ?? createLayaCalibrationFromEnvironment());
}

function createJevFromEnvironment(config: IntelligenceConfig): JevProvider {
  if (process.env.EAMILOS_INTELLIGENCE_MOCK === '1') return new MockJevProvider();
  const endpoint = process.env.EAMILOS_JEV_URL;
  const apiKey = process.env.EAMILOS_JEV_API_KEY;
  if (!endpoint || !apiKey) return new DeterministicJevProvider();
  return new JevHttpProvider({ endpoint, apiKey, timeoutMs: config.jev.timeoutMs, healthEndpoint: process.env.EAMILOS_JEV_HEALTH_URL });
}

function createLayaFromEnvironment(config: IntelligenceConfig): LayaModelAdapter {
  const command = process.env.EAMILOS_LAYA_COMMAND;
  if (!command) return new FallbackLayaAdapter();
  let args: string[] = [];
  if (process.env.EAMILOS_LAYA_ARGS) {
    const parsed = JSON.parse(process.env.EAMILOS_LAYA_ARGS);
    if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) throw new Error('EAMILOS_LAYA_ARGS must be a JSON string array.');
    args = parsed;
  }
  return new LayaProcessAdapter({ command, args, timeoutMs: config.laya.timeoutMs, cwd: process.cwd() });
}
function createLayaTypedFromEnvironment(config: IntelligenceConfig) {
  const endpoint = process.env.EAMILOS_LAYA_URL;
  if (endpoint) return new LayaHttpDecisionAdapter({ endpoint, apiKey: process.env.EAMILOS_LAYA_API_KEY, timeoutMs: config.laya.timeoutMs, model: process.env.EAMILOS_LAYA_MODEL || 'typed-decisions' });
  const command = process.env.EAMILOS_LAYA_COMMAND;
  if (command) return new LayaProcessDecisionAdapter({ command, args: process.env.EAMILOS_LAYA_ARGS ? JSON.parse(process.env.EAMILOS_LAYA_ARGS) : [], timeoutMs: config.laya.timeoutMs, cwd: process.cwd() });
  return undefined;
}

function createLayaCalibrationFromEnvironment(): LayaCalibrationConfig {
  return {
    enabled: process.env.EAMILOS_LAYA_CALIBRATION === '1',
    choiceTemperature: Number(process.env.EAMILOS_LAYA_CHOICE_TEMPERATURE || 1),
    scoreTemperature: Number(process.env.EAMILOS_LAYA_SCORE_TEMPERATURE || 1),
    noulTemperature: Number(process.env.EAMILOS_LAYA_NOUL_TEMPERATURE || 1),
    minimumConfidence: Number(process.env.EAMILOS_LAYA_MIN_CONFIDENCE || 0.6),
    minimumProbability: Number(process.env.EAMILOS_LAYA_MIN_PROBABILITY || 0.6),
  };
}
