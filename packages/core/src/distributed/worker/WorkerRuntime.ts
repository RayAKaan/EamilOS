import { io, Socket } from 'socket.io-client';
import * as os from 'os';
import * as crypto from 'crypto';
import { EventEmitter } from 'events';

export interface WorkerConfig {
  nodeId: string;
  controllerHost: string;
  controllerPort: number;
  capabilities: string[];
  resources?: WorkerResources;
  hmacSecret?: string;
}

export interface WorkerResources {
  cpu: number;
  memory: {
    total: number;
    free: number;
    used: number;
  };
  gpu: boolean;
  platform: string;
}

export class WorkerRuntime extends EventEmitter {
  private socket?: Socket;
  private tasks: Map<string, { startTime: number; payload: unknown }> = new Map();
  private heartbeatInterval?: NodeJS.Timeout;
  private connected: boolean = false;

  constructor(private config: WorkerConfig) {
    super();
  }

  async start(): Promise<void> {
    const hmacSecret = this.config.hmacSecret || process.env.EAMILOS_HMAC_SECRET || 'default';
    const timestamp = Date.now();
    const payload = `${this.config.nodeId}:${timestamp}`;
    const hmac = crypto.createHmac('sha256', hmacSecret).update(payload).digest('hex');

    this.socket = io(`http://${this.config.controllerHost}:${this.config.controllerPort}`, {
      auth: {
        nodeId: this.config.nodeId,
        timestamp,
        hmac,
        capabilities: this.config.capabilities,
        resources: this.getSystemResources()
      },
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 2000,
      timeout: 10000
    });

    return new Promise((resolve, reject) => {
      if (!this.socket) {
        reject(new Error('Socket not initialized'));
        return;
      }

      this.socket.on('connect', () => {
        this.connected = true;
        this.emit('connected', { nodeId: this.config.nodeId });
        
        this.startHeartbeat();
        resolve();
      });

      this.socket.on('connect_error', (error) => {
        this.connected = false;
        this.emit('connection_error', { error: error.message });
        reject(error);
      });

      this.socket.on('disconnect', (reason) => {
        this.connected = false;
        this.emit('disconnected', { reason });
      });

      this.socket.on('disconnect', () => {
        this.connected = false;
      });

      this.setupMessageHandlers();
    });
  }

  private getSystemResources(): WorkerResources {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    
    return {
      cpu: os.loadavg()[0] / os.cpus().length,
      memory: {
        total: totalMem,
        free: freeMem,
        used: totalMem - freeMem
      },
      gpu: false,
      platform: os.platform()
    };
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      if (this.socket?.connected) {
        this.socket.emit('heartbeat', {
          resources: this.getSystemResources(),
          timestamp: Date.now(),
          taskCount: this.tasks.size
        });
      }
    }, 5000);
  }

  private setupMessageHandlers(): void {
    if (!this.socket) return;

    this.socket.on('task:dispatch', async (task: any, callback: Function) => {
      const taskStartTime = Date.now();
      this.tasks.set(task.id, { startTime: taskStartTime, payload: task.payload });

      try {
        this.emit('task:received', { taskId: task.id });

        const result = await this.executeTask(task);

        this.socket?.emit('task:result', {
          taskId: task.id,
          success: true,
          output: result,
          metrics: this.getSystemResources(),
          completedAt: Date.now(),
          durationMs: Date.now() - taskStartTime
        });

        callback({ success: true, taskId: task.id });
      } catch (error) {
        this.socket?.emit('task:result', {
          taskId: task.id,
          success: false,
          error: error instanceof Error ? error.message : String(error),
          completedAt: Date.now(),
          durationMs: Date.now() - taskStartTime
        });

        callback({
          success: false,
          error: error instanceof Error ? error.message : String(error),
          taskId: task.id
        });
      } finally {
        this.tasks.delete(task.id);
      }
    });

    this.socket.on('health:check', (callback: Function) => {
      callback(this.getSystemResources());
    });

    this.socket.on('worker:shutdown', () => {
      this.emit('shutdown_requested');
      this.stop();
    });

    this.socket.on('node:ready', (data: any) => {
      this.emit('node_ready', data);
    });
  }

  protected executeTask(task: any): Promise<unknown> {
    this.emit('task:executing', { taskId: task.id });
    
    return Promise.resolve({
      taskId: task.id,
      output: `Executed on worker ${this.config.nodeId}`,
      timestamp: Date.now()
    });
  }

  isConnected(): boolean {
    return this.connected;
  }

  getActiveTaskCount(): number {
    return this.tasks.size;
  }

  async stop(): Promise<void> {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = undefined;
    }

    if (this.socket) {
      this.socket.disconnect();
      this.socket = undefined;
    }

    this.connected = false;
  }
}