import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { A2AEnvelopeSchema, AgentCardSchema, TaskRequestSchema, assertTaskRequestFresh, type AgentCard, type TaskRequest, type EamilosA2AMessage, type TaskAccepted, type TaskRejected, type Heartbeat } from './EamilosA2AProtocol.js';
import { EamilosA2ATaskStore, type EamilosA2ATaskStoreLike } from './EamilosA2ATaskStore.js';
import { EamilosA2ASqliteTaskStore } from './EamilosA2ASqliteTaskStore.js';

const MAX_BODY_BYTES = 1_000_000;

export interface EamilosA2AServerOptions {
  card: AgentCard;
  workerId: string;
  taskStore?: EamilosA2ATaskStoreLike;
  taskStoreFilename?: string;
  validateRequest?: (request: TaskRequest) => Promise<void> | void;
  onTaskRequest?: (request: TaskRequest) => Promise<TaskAccepted | TaskRejected>;
  onCancel?: (request: TaskRequest, reason?: string) => Promise<void> | void;
  activeExecutions?: () => number;
  capacity?: () => number;
  currentGraphVersion?: () => number;
  currentContextHash?: () => string | undefined;
}

export class EamilosA2AServer {
  readonly tasks: EamilosA2ATaskStoreLike;
  private server: Server | null = null;
  private readonly ownsTaskStore: boolean;

  constructor(private readonly options: EamilosA2AServerOptions) {
    AgentCardSchema.parse(options.card);
    if (options.taskStore && options.taskStoreFilename) throw new Error('Specify taskStore or taskStoreFilename, not both');
    this.ownsTaskStore = !options.taskStore && Boolean(options.taskStoreFilename);
    this.tasks = options.taskStore
      ?? (options.taskStoreFilename ? new EamilosA2ASqliteTaskStore({ filename: options.taskStoreFilename }) : new EamilosA2ATaskStore());
  }

  async start(host = '127.0.0.1', port = 0): Promise<{ host: string; port: number }> {
    if (this.server) throw new Error('EamilOS A2A server already started');
    this.server = createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(port, host, resolve);
    });
    const address = this.server.address();
    if (!address || typeof address === 'string') throw new Error('A2A server address unavailable');
    return { host, port: address.port };
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    const server = this.server;
    this.server = null;
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    if (this.ownsTaskStore) this.tasks.close?.();
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const path = req.url?.split('?')[0] ?? '/';
      if (req.method === 'GET' && (path === '/.well-known/eamilos-agent.json' || path === '/.well-known/agent-card.json')) {
        return this.send(res, 200, this.options.card);
      }
      if (req.method === 'GET' && path === '/eamilos/a2a/capabilities') {
        const capabilities = {
          kind: 'capability.advertisement' as const,
          protocolVersion: 1 as const,
          workerId: this.options.card.workerId,
          agentId: this.options.card.agentId,
          harnessId: this.options.card.harnessId,
          capabilities: this.options.card.capabilities,
          maxConcurrency: this.options.card.maxConcurrency,
          activeExecutions: this.options.activeExecutions?.() ?? 0,
          metadata: this.options.card.metadata,
          advertisedAt: new Date().toISOString(),
        };
        return this.send(res, 200, capabilities);
      }
      if (req.method === 'GET' && path === '/eamilos/a2a/heartbeat') {
        const heartbeat: Heartbeat = {
          kind: 'heartbeat',
          protocolVersion: 1,
          workerId: this.options.workerId,
          timestamp: new Date().toISOString(),
          activeExecutions: this.options.activeExecutions?.() ?? 0,
          capacity: this.options.capacity?.() ?? this.options.card.maxConcurrency,
          sequence: Date.now(),
        };
        return this.send(res, 200, heartbeat);
      }
      if (req.method === 'POST' && path === '/eamilos/a2a/tasks') {
        const request = TaskRequestSchema.parse(await this.parseBody(req));
        const existing = this.tasks.getByIdempotencyKey(request.idempotencyKey);
        if (existing) {
          if (existing.request.executionId !== request.executionId) {
            return this.send(res, 409, { error: 'IDEMPOTENCY_KEY_CONFLICT' });
          }
          return this.send(res, 200, existing.latest ?? acceptedFromRequest(request, this.options.workerId));
        }

        try {
          if (this.options.currentGraphVersion) {
            assertTaskRequestFresh(request, this.options.currentGraphVersion(), this.options.currentContextHash?.());
          }
          await this.options.validateRequest?.(request);
          this.tasks.put(request);
          const decision = this.options.onTaskRequest
            ? await this.options.onTaskRequest(request)
            : acceptedFromRequest(request, this.options.workerId);
          this.tasks.append(decision);
          return this.send(res, decision.kind === 'task.accepted' ? 202 : 409, decision);
        } catch (error) {
          const rejection: TaskRejected = {
            ...correlation(request),
            kind: 'task.rejected',
            workerId: this.options.workerId,
            reason: 'invalid_request',
            details: error instanceof Error ? error.message : String(error),
          };
          if (!this.tasks.get(request.executionId)) this.tasks.put(request);
          this.tasks.append(rejection);
          return this.send(res, 409, rejection);
        }
      }
      const cancel = path.match(/^\/eamilos\/a2a\/tasks\/([^/]+)\/cancel$/);
      if (req.method === 'POST' && cancel) {
        const executionId = decodeURIComponent(cancel[1]!);
        const stored = this.tasks.get(executionId);
        if (!stored) return this.send(res, 404, { error: 'EXECUTION_NOT_FOUND' });
        const body = await this.parseBody(req).catch(() => ({})) as { reason?: unknown };
        await this.options.onCancel?.(stored.request, typeof body.reason === 'string' ? body.reason : undefined);
        const message: EamilosA2AMessage = {
          ...correlation(stored.request),
          kind: 'task.cancelled',
          workerId: this.options.workerId,
          reason: typeof body.reason === 'string' ? body.reason : undefined,
        };
        this.tasks.append(message);
        return this.send(res, 200, message);
      }
      return this.send(res, 404, { error: 'NOT_FOUND' });
    } catch (error) {
      return this.send(res, 400, { error: error instanceof Error ? error.message : String(error) });
    }
  }

  private async parseBody(req: IncomingMessage): Promise<unknown> {
    const contentLength = Number(req.headers['content-length'] ?? 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) throw new Error('A2A request body too large');
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      const value = Buffer.from(chunk);
      size += value.length;
      if (size > MAX_BODY_BYTES) throw new Error('A2A request body too large');
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }

  private send(res: ServerResponse, status: number, value: unknown): void {
    res.statusCode = status;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(value));
  }
}

function correlation(request: TaskRequest) {
  return {
    protocolVersion: 1 as const,
    missionId: request.missionId,
    taskId: request.taskId,
    executionId: request.executionId,
    requestId: request.requestId,
    idempotencyKey: request.idempotencyKey,
    graphVersion: request.graphVersion,
    timestamp: new Date().toISOString(),
  };
}

function acceptedFromRequest(request: TaskRequest, workerId: string): TaskAccepted {
  return { ...correlation(request), kind: 'task.accepted', workerId };
}
