import type { SessionRuntime } from '../../core/session/SessionRuntime.js';
import { createSessionEventBridge } from './TuiEventBridge.js';

let runtime: SessionRuntime | null = null;

export function setRuntime(inst: SessionRuntime): void {
  runtime = inst;
}

export function getRuntime(): SessionRuntime {
  if (!runtime) throw new Error('Session runtime not initialized');
  return runtime;
}

export function getOrchestrator() {
  return getRuntime().orchestrator;
}

export function initializeServices(rt: SessionRuntime): () => void {
  setRuntime(rt);
  return createSessionEventBridge(rt);
}
