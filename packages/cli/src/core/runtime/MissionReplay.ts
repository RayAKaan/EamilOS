import type { RuntimeEvent, RuntimeSnapshot } from './types.js';
import type { MissionEventStore, MissionCheckpoint } from './MissionEventStore.js';
import type { MissionProjection } from './MissionProjection.js';

export interface ReplayResult<T> {
  state: T;
  eventsApplied: number;
  lastEvent?: RuntimeEvent;
  checkpointUsed?: MissionCheckpoint<T>;
}

export class MissionReplay {
  constructor(private readonly store: MissionEventStore) {}

  async run<T>(missionId: string, projection: MissionProjection<T>, options: {
    useCheckpoint?: boolean;
    untilSequence?: number;
  } = {}): Promise<ReplayResult<T>> {
    const checkpoint = options.useCheckpoint === false ? undefined : await this.store.loadCheckpoint<T>(missionId);
    const replay = await this.store.replay(missionId, projection.apply, projection.initial(), {
      untilSequence: options.untilSequence,
      fromCheckpoint: checkpoint && checkpoint.sequence <= (options.untilSequence ?? Number.MAX_SAFE_INTEGER) ? checkpoint : undefined,
    });
    return { ...replay, checkpointUsed: checkpoint };
  }

  async reconstructSnapshot(missionId: string): Promise<RuntimeSnapshot | undefined> {
    const events = await this.store.load(missionId);
    const last = events.at(-1);
    if (!last) return undefined;
    const initial: RuntimeSnapshot = {
      version: 1,
      missionId,
      state: 'CREATED',
      health: 'HEALTHY',
      counters: { executions: 0, retries: 0, replans: 0, jevDecisions: 0, layaPlans: 0, costUsd: 0, startedAt: last.timestamp },
      activeExecutions: [],
      updatedAt: last.timestamp,
    };
    const state = events.reduce<RuntimeSnapshot>((current, event) => applyRuntimeSnapshot(current, event), initial);
    /*
      version: 1,
      missionId,
      state: 'CREATED',
      health: 'HEALTHY',
      counters: { executions: 0, retries: 0, replans: 0, jevDecisions: 0, layaPlans: 0, costUsd: 0, startedAt: last.timestamp },
      activeExecutions: [],
      lastEventId: undefined,
      lastCheckpointId: undefined,
      updatedAt: last.timestamp,
    }; */
    return state;
  }
}

function applyRuntimeSnapshot(state: RuntimeSnapshot, event: RuntimeEvent): RuntimeSnapshot {
  const next = structuredClone(state);
  next.lastEventId = event.eventId;
  next.updatedAt = event.timestamp;
  switch (event.type) {
    case 'runtime.started': next.state = 'STARTING'; break;
    case 'planning.requested': next.state = 'PLANNING'; break;
    case 'scheduling.requested': next.state = 'SCHEDULING'; break;
    case 'execution.started':
      next.state = 'EXECUTING';
      next.counters.executions += 1;
      if (event.executionId && !next.activeExecutions.includes(event.executionId)) next.activeExecutions.push(event.executionId);
      break;
    case 'execution.completed':
      if (event.executionId) next.activeExecutions = next.activeExecutions.filter(id => id !== event.executionId);
      break;
    case 'execution.failed':
      next.state = 'FAILED';
      if (event.executionId) next.activeExecutions = next.activeExecutions.filter(id => id !== event.executionId);
      if (event.payload.retryable === true) next.counters.retries += 1;
      break;
    case 'validation.started': next.state = 'VALIDATING'; break;
    case 'validation.passed': next.state = 'EXECUTING'; break;
    case 'recovery.started': next.state = 'RECOVERING'; next.health = 'RECOVERING'; break;
    case 'recovery.completed':
      next.health = event.payload.recovered === true ? 'HEALTHY' : 'BLOCKED';
      break;
    case 'replan.started': next.state = 'REPLANNING'; next.counters.replans += 1; break;
    case 'runtime.paused': next.state = 'PAUSED'; break;
    case 'runtime.resumed': next.state = 'EXECUTING'; break;
    case 'runtime.completed': next.state = 'COMPLETED'; next.health = 'HEALTHY'; next.activeExecutions = []; break;
    case 'runtime.failed': next.state = 'FAILED'; next.health = 'UNAVAILABLE'; break;
    case 'runtime.stopped': next.state = 'STOPPING'; break;
    default: break;
  }
  return next;
}
