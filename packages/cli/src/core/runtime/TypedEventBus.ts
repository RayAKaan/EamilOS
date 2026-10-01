import { EventEmitter } from 'node:events';

export type EventListener<T> = (payload: T) => void | Promise<void>;

export class TypedEventBus<Events extends Record<string, unknown>> {
  private readonly emitter = new EventEmitter();

  on<K extends keyof Events & string>(event: K, listener: EventListener<Events[K]>): () => void {
    this.emitter.on(event, listener);
    return () => this.emitter.off(event, listener);
  }

  once<K extends keyof Events & string>(event: K, listener: EventListener<Events[K]>): () => void {
    const wrapped = (payload: Events[K]) => listener(payload);
    this.emitter.once(event, wrapped);
    return () => this.emitter.off(event, wrapped);
  }

  emit<K extends keyof Events & string>(event: K, payload: Events[K]): void {
    this.emitter.emit(event, payload);
  }

  removeAllListeners(): void {
    this.emitter.removeAllListeners();
  }

  listenerCount<K extends keyof Events & string>(event: K): number {
    return this.emitter.listenerCount(event);
  }
}
