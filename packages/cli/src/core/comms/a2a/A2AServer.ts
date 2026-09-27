import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { A2ATaskStore } from './A2ATaskStore.js';
import { A2ATaskSchema, type A2AAgentCard, type A2ATask } from './types.js';
import { A2AAgentCardSchema } from './schemas.js';

const MAX_BODY_BYTES = 1_000_000;

export class A2AServer {
  private server: Server | null = null;
  readonly tasks: A2ATaskStore;

  constructor(private readonly card: A2AAgentCard, tasks?: A2ATaskStore) {
    A2AAgentCardSchema.parse(card);
    this.tasks = tasks ?? new A2ATaskStore();
  }

  async start(host = '127.0.0.1', port = 0): Promise<{ host: string; port: number }> {
    if (this.server) throw new Error('A2A server already started');
    this.server = createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(port, host, () => resolve());
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
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    res.setHeader('content-type', 'application/json');
    try {
      const path = req.url?.split('?')[0] ?? '/';

      if (req.method === 'GET' && (path === '/' || path === '/agent-card')) {
        return this.send(res, 200, this.card);
      }

      if (req.method === 'POST' && path === '/tasks') {
        const input = await this.parseTaskBody(req);
        const now = new Date().toISOString();
        const task = A2ATaskSchema.parse({
          id: input.id ?? randomUUID(),
          contextId: input.contextId ?? randomUUID(),
          state: 'submitted',
          messages: input.messages ?? [],
          artifacts: input.artifacts ?? [],
          metadata: input.metadata ?? {},
          createdAt: now,
          updatedAt: now,
        });
        this.tasks.put(task);
        return this.send(res, 202, task);
      }

      const match = path.match(/^\/tasks\/([^/]+)$/);
      if (match) {
        const taskId = decodeURIComponent(match[1]!);
        const task = this.tasks.get(taskId);
        if (!task) return this.send(res, 404, { error: 'task_not_found' });
        if (req.method === 'GET') return this.send(res, 200, task);
        if (req.method === 'DELETE') return this.send(res, 200, this.tasks.update(task.id, { state: 'canceled' }));
      }

      return this.send(res, 404, { error: 'not_found' });
    } catch (error) {
      return this.send(res, 400, { error: error instanceof Error ? error.message : String(error) });
    }
  }

  private async parseTaskBody(req: IncomingMessage): Promise<Partial<A2ATask>> {
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
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('A2A task body must be an object');
    return parsed as Partial<A2ATask>;
  }

  private send(res: ServerResponse, status: number, value: unknown): void {
    res.statusCode = status;
    res.end(JSON.stringify(value));
  }
}
