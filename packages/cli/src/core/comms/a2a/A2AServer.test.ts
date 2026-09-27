import { describe, expect, it } from 'vitest';
import { A2AServer } from './A2AServer.js';
import { DefaultA2AClient } from './A2AClient.js';

describe('A2A server/client', () => {
  it('discovers, submits, reads, and cancels a task', async () => {
    const server = new A2AServer({
      name: 'test-agent',
      description: 'test',
      version: '1.0.0',
      capabilities: { streaming: false, pushNotifications: false },
      skills: [],
    });
    const address = await server.start('127.0.0.1', 0);
    try {
      const url = `http://${address.host}:${address.port}`;
      const client = new DefaultA2AClient();
      expect((await client.discover(url)).name).toBe('test-agent');
      const now = new Date().toISOString();
      const task = await client.sendTask(url, {
        id: 't1',
        contextId: 'c1',
        state: 'submitted',
        messages: [],
        artifacts: [],
        metadata: {},
        createdAt: now,
        updatedAt: now,
      });
      expect(task.state).toBe('submitted');
      expect((await client.getTask(url, 't1')).id).toBe('t1');
      expect((await client.cancelTask(url, 't1')).state).toBe('canceled');
    } finally {
      await server.stop();
    }
  });
});