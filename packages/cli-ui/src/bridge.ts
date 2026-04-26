import { EventEmitter } from 'events';
import { useStore } from './state/store';

interface BridgeConfig {
  mockMode?: boolean;
}

export class UIBridge extends EventEmitter {
  private syncInterval?: NodeJS.Timeout;
  private mockMode: boolean;

  constructor(config?: BridgeConfig) {
    super();
    this.mockMode = config?.mockMode ?? process.env.MOCK === 'true';
  }

  async initialize(): Promise<void> {
    if (this.mockMode) {
      this.initializeMockMode();
    }
  }

  private initializeMockMode(): void {
    console.log('[Bridge] Running in mock mode');
  }

  async createTask(input: string): Promise<any> {
    const taskId = `task-${Date.now()}`;
    const store = useStore.getState();
    store.addNode(null, {
      id: taskId,
      status: 'running',
      children: [],
      type: 'task'
    } as any);
    store.setRunning(true);
    return { taskId, success: true };
  }

  async pauseAgent(_agentId: string): Promise<void> {
    // pause agent
  }

  async killAgent(_agentId: string): Promise<void> {
    const store = useStore.getState();
    store.setTree(null);
  }

  async pauseCurrentTask(): Promise<void> {
    const store = useStore.getState();
    store.setRunning(false);
  }

  async stopCurrentTask(): Promise<void> {
    const store = useStore.getState();
    store.resetExecution();
  }

  createTaskPrompt(): void {}

  navigateTo(view: string): void {
    this.emit('navigate', view);
  }

  getState() {
    return useStore.getState();
  }

  getStore() {
    return useStore;
  }

  async shutdown(): Promise<void> {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
    }
    this.emit('shutdown');
  }
}

export const createBridge = (config?: BridgeConfig): UIBridge => {
  return new UIBridge(config);
};