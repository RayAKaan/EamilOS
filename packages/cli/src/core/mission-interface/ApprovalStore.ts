import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ApprovalRequestSchema, type ApprovalRequest, type MissionControlAction } from './types.js';

export class ApprovalStore {
  constructor(private readonly root = join(process.cwd(), '.eamilos', 'approvals')) {}

  private path(missionId: string): string {
    return join(this.root, `${missionId}.json`);
  }

  async list(missionId: string): Promise<ApprovalRequest[]> {
    try {
      const value = JSON.parse(await readFile(this.path(missionId), 'utf8'));
      return Array.isArray(value) ? value.map(item => ApprovalRequestSchema.parse(item)) : [];
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error
        ? (error as { code?: string }).code
        : undefined;
      if (code === 'ENOENT') return [];
      throw error;
    }
  }

  async request(input: {
    missionId: string;
    action: MissionControlAction;
    reason: string;
    taskId?: string;
  }): Promise<ApprovalRequest> {
    const requests = await this.list(input.missionId);
    const existing = requests.find(item =>
      item.action === input.action &&
      item.taskId === input.taskId &&
      item.status === 'PENDING',
    );
    if (existing) return existing;

    const request = ApprovalRequestSchema.parse({
      id: `approval_${randomUUID()}`,
      missionId: input.missionId,
      action: input.action,
      status: 'PENDING',
      reason: input.reason,
      taskId: input.taskId,
      requestedAt: new Date().toISOString(),
    });
    requests.push(request);
    await this.save(input.missionId, requests);
    return request;
  }

  async resolve(missionId: string, id: string, approved: boolean, resolvedBy = 'user'): Promise<ApprovalRequest> {
    const requests = await this.list(missionId);
    const index = requests.findIndex(item => item.id === id);
    if (index < 0) throw new Error(`Approval request not found: ${id}`);
    const current = requests[index];
    if (current.status !== 'PENDING') throw new Error(`Approval request ${id} is already ${current.status.toLowerCase()}`);
    const resolved = ApprovalRequestSchema.parse({
      ...current,
      status: approved ? 'APPROVED' : 'DENIED',
      resolvedAt: new Date().toISOString(),
      resolvedBy,
    });
    requests[index] = resolved;
    await this.save(missionId, requests);
    return resolved;
  }

  async consumeApproved(missionId: string, action: MissionControlAction, taskId?: string): Promise<ApprovalRequest | undefined> {
    const requests = await this.list(missionId);
    const index = requests.findIndex(item =>
      item.action === action &&
      item.taskId === taskId &&
      item.status === 'APPROVED',
    );
    if (index < 0) return undefined;
    const consumed = ApprovalRequestSchema.parse({
      ...requests[index],
      status: 'CONSUMED',
      consumedAt: new Date().toISOString(),
    });
    requests[index] = consumed;
    await this.save(missionId, requests);
    return consumed;
  }

  private async save(missionId: string, requests: ApprovalRequest[]): Promise<void> {
    await mkdir(dirname(this.path(missionId)), { recursive: true });
    const target = this.path(missionId);
    const temp = `${target}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(requests, null, 2), 'utf8');
    await rename(temp, target);
  }
}
