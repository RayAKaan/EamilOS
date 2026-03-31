import { PluginEventHandler } from './types.js';
import { SecureLogger } from '../security/SecureLogger.js';

interface Listener {
  handler: PluginEventHandler;
  pluginId?: string;
}

interface EventHistory {
  event: string;
  timestamp: string;
  listenerCount: number;
}

export class EventBus {
  private listeners: Map<string, Listener[]> = new Map();
  private logger: SecureLogger;
  private history: EventHistory[] = [];

  constructor(logger: SecureLogger) {
    this.logger = logger;
  }

  on(event: string, handler: PluginEventHandler, pluginId?: string): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push({ handler, pluginId });

    this.logger.log("debug", `Event listener registered: ${event}`, {
      pluginId: pluginId || "system",
      totalListeners: this.listeners.get(event)!.length
    });
  }

  off(event: string, handler: PluginEventHandler): void {
    const eventListeners = this.listeners.get(event);
    if (!eventListeners) return;

    const index = eventListeners.findIndex(l => l.handler === handler);
    if (index !== -1) eventListeners.splice(index, 1);
  }

  removePluginListeners(pluginId: string): void {
    for (const [event, listeners] of this.listeners) {
      this.listeners.set(
        event,
        listeners.filter(l => l.pluginId !== pluginId)
      );
    }
  }

  async emit(event: string, data: Record<string, unknown> = {}): Promise<void> {
    const eventListeners = this.listeners.get(event) || [];

    this.history.push({
      event,
      timestamp: new Date().toISOString(),
      listenerCount: eventListeners.length
    });
    if (this.history.length > 1000) {
      this.history = this.history.slice(-500);
    }

    for (const listener of eventListeners) {
      try {
        await listener.handler(data);
      } catch (error) {
        this.logger.log("warn", `Event handler error: ${event}`, {
          pluginId: listener.pluginId || "system",
          error: error instanceof Error ? error.message : String(error),
          action: "Handler error caught. Other handlers continue."
        });
      }
    }
  }

  getRegisteredEvents(): string[] {
    return [...this.listeners.keys()].filter(e => (this.listeners.get(e)?.length || 0) > 0);
  }

  getHistory(limit: number = 50): EventHistory[] {
    return this.history.slice(-limit);
  }
}
