import { SessionOrchestrator, createSessionOrchestrator } from './SessionOrchestrator.js';
import { SessionEventBus } from './SessionEventBus.js';
import type { SessionConfig } from '../agents/types.js';
import type { SessionResult } from './SessionOrchestrator.js';
import type { SessionEventMap } from './events.js';

export class SessionRuntime {
  readonly orchestrator: SessionOrchestrator;
  readonly events: SessionEventBus;

  constructor(config: SessionConfig) {
    this.orchestrator = createSessionOrchestrator(config);
    this.events = new SessionEventBus();
    this.bridgeEvents();
  }

  private bridgeEvents(): void {
    const events: (keyof SessionEventMap)[] = [
      'session.started', 'agent.started', 'agent.output', 'agent.fallback',
      'agent.completed', 'agent.error', 'file.proposed', 'validation.started',
      'validation.passed', 'validation.failed', 'changes.collected',
      'changes.applied', 'staging.cleaned', 'session.completed',
      'session.error', 'permission.requested', 'budget.updated',
    ];
    for (const event of events) {
      this.orchestrator.on(event, (data: any) => {
        this.events.emit(event, data);
      });
    }
  }

  on<K extends keyof SessionEventMap>(event: K, listener: (data: SessionEventMap[K]) => void): () => void {
    return this.events.on(event, listener);
  }

  async run(): Promise<SessionResult> {
    return this.orchestrator.run();
  }

  async stop(): Promise<void> {
    await this.orchestrator.stop();
  }
}
