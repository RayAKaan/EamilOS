import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import type { CommsMessage, DeliveryReceipt } from './types.js';

export class MessageStore {
  constructor(private readonly root = join(process.cwd(), '.eamilos', 'comms')) {}

  private async ensure() { await fs.mkdir(this.root, { recursive: true }); }
  private path(id: string) { return join(this.root, 'messages', `${id}.json`); }
  private receiptPath(id: string) { return join(this.root, 'receipts', `${id}.json`); }

  async save(message: CommsMessage): Promise<void> {
    await this.ensure();
    const path = this.path(message.messageId);
    await fs.mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
    await fs.writeFile(tmp, JSON.stringify(message, null, 2), 'utf8');
    await fs.rename(tmp, path);
  }

  async get(id: string): Promise<CommsMessage | null> {
    try { return JSON.parse(await fs.readFile(this.path(id), 'utf8')) as CommsMessage; }
    catch { return null; }
  }

  async saveReceipt(receipt: DeliveryReceipt): Promise<void> {
    await this.ensure();
    const path = this.receiptPath(receipt.messageId + '-' + receipt.recipientId);
    await fs.mkdir(dirname(path), { recursive: true });
    await fs.writeFile(path, JSON.stringify(receipt), 'utf8');
  }

  async hasReceipt(messageId: string, recipientId: string): Promise<boolean> {
    try { await fs.access(this.receiptPath(messageId + '-' + recipientId)); return true; }
    catch { return false; }
  }
}
