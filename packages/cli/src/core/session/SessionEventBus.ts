import { EventEmitter } from 'events';
import type { SessionEventMap } from './events.js';

type Listener<K extends keyof SessionEventMap> = (data: SessionEventMap[K]) => void;

export class SessionEventBus {
  private emitter = new EventEmitter();

  on<K extends keyof SessionEventMap>(event: K, listener: Listener<K>): () => void {
    this.emitter.on(event, listener);
    return () => { this.emitter.off(event, listener); };
  }

  off<K extends keyof SessionEventMap>(event: K, listener: Listener<K>): void {
    this.emitter.off(event, listener);
  }

  emit<K extends keyof SessionEventMap>(event: K, data: SessionEventMap[K]): void {
    this.emitter.emit(event, data);
  }

  removeAllListeners(): void {
    this.emitter.removeAllListeners();
  }
}
