import { EventCreate, SystemEvent, EventType } from './types.js';
import { getDatabase, DatabaseManager } from './db.js';

type EventHandler = (event: SystemEvent) => void | Promise<void>;

export class EventBus {
  private handlers: Map<EventType | '*', EventHandler[]> = new Map();
  private db: DatabaseManager;
  private correlationId: string | null = null;

  constructor(db?: DatabaseManager) {
    this.db = db ?? getDatabase();
  }

  on(type: EventType | '*', handler: EventHandler): void {
    const existing = this.handlers.get(type) ?? [];
    this.handlers.set(type, [...existing, handler]);
  }

  off(type: EventType | '*', handler: EventHandler): void {
    const existing = this.handlers.get(type);
    if (existing) {
      this.handlers.set(
        type,
        existing.filter((h) => h !== handler)
      );
    }
  }

  setCorrelationId(id: string | null): void {
    this.correlationId = id;
  }

  async emit(data: EventCreate): Promise<SystemEvent> {
    const event = this.db.createEvent({
      ...data,
      correlationId: data.correlationId ?? this.correlationId ?? undefined,
    });

    const handlers = this.handlers.get(data.type) ?? [];
    const wildcardHandlers = this.handlers.get('*') ?? [];
    const allHandlers = [...handlers, ...wildcardHandlers];

    for (const handler of allHandlers) {
      try {
        await handler(event);
      } catch (error) {
        console.error(`Event handler error for ${data.type}:`, error);
      }
    }

    return event;
  }

  async emitAsync(data: EventCreate): Promise<void> {
    await this.emit(data);
  }

  emitSync(data: EventCreate): SystemEvent {
    return this.db.createEvent({
      ...data,
      correlationId: data.correlationId ?? this.correlationId ?? undefined,
    });
  }
}

let globalEventBus: EventBus | null = null;

export function initEventBus(db?: DatabaseManager): EventBus {
  globalEventBus = new EventBus(db);
  return globalEventBus;
}

export function getEventBus(): EventBus {
  if (!globalEventBus) {
    return initEventBus();
  }
  return globalEventBus;
}
