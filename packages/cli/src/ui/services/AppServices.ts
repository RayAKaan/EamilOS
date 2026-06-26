import type { SessionOrchestrator } from '../../core/session/SessionOrchestrator.js';
import { createSessionEventBridge } from './TuiEventBridge.js';

let orchestrator: SessionOrchestrator | null = null;

export function setOrchestrator(inst: SessionOrchestrator): void {
  orchestrator = inst;
}

export function getOrchestrator(): SessionOrchestrator {
  if (!orchestrator) throw new Error('Orchestrator not initialized');
  return orchestrator;
}

export function initializeServices(inst: SessionOrchestrator): () => void {
  setOrchestrator(inst);
  return createSessionEventBridge(inst);
}
