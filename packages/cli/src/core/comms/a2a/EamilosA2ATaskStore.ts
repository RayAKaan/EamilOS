import { isTerminalMessage, taskRequestFingerprint, type TaskRequest, type EamilosA2AMessage } from './EamilosA2AProtocol.js';

export interface StoredTask {
  request: TaskRequest;
  fingerprint: string;
  latest?: EamilosA2AMessage;
  history: EamilosA2AMessage[];
  createdAt: string;
  updatedAt: string;
}

export class EamilosA2ATaskStore {
  private readonly tasks = new Map<string, StoredTask>();
  private readonly idempotency = new Map<string, string>();

  put(request: TaskRequest): StoredTask {
    const existingId = this.idempotency.get(request.idempotencyKey);
    if (existingId && existingId !== request.executionId) throw new Error('IDEMPOTENCY_KEY_CONFLICT');

    const existing = this.tasks.get(request.executionId);
    const fingerprint = taskRequestFingerprint(request);
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw new Error('EXECUTION_ID_REUSE_CONFLICT');
      return existing;
    }

    const now = new Date().toISOString();
    const task: StoredTask = { request, fingerprint, history: [], createdAt: now, updatedAt: now };
    this.tasks.set(request.executionId, task);
    this.idempotency.set(request.idempotencyKey, request.executionId);
    return task;
  }

  get(executionId: string): StoredTask | undefined {
    return this.tasks.get(executionId);
  }

  getByIdempotencyKey(key: string): StoredTask | undefined {
    const executionId = this.idempotency.get(key);
    return executionId ? this.tasks.get(executionId) : undefined;
  }

  append(message: EamilosA2AMessage): StoredTask {
    if (!('executionId' in message)) throw new Error('Message is not execution-correlated');
    const task = this.tasks.get(message.executionId);
    if (!task) throw new Error(`Unknown execution: ${message.executionId}`);
    if (task.latest && !isValidTransition(task.latest.kind, message.kind)) {
      throw new Error(`INVALID_A2A_TRANSITION:${task.latest.kind}->${message.kind}`);
    }
    task.latest = message;
    task.history.push(message);
    task.updatedAt = new Date().toISOString();
    return task;
  }

  list(): StoredTask[] {
    return [...this.tasks.values()];
  }
}

function isValidTransition(
  from: EamilosA2AMessage['kind'],
  to: EamilosA2AMessage['kind'],
): boolean {
  if (isTerminalMessage({ kind: from } as EamilosA2AMessage)) return false;
  if (from === 'task.request') return to === 'task.accepted' || to === 'task.rejected' || to === 'task.cancelled';
  if (from === 'task.accepted') return to === 'task.progress' || to === 'task.completed' || to === 'task.failed' || to === 'task.cancelled';
  if (from === 'task.progress') return to === 'task.progress' || to === 'task.completed' || to === 'task.failed' || to === 'task.cancelled';
  return false;
}
