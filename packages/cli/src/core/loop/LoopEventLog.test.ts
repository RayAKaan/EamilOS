import { describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LoopEventLog } from './LoopEventLog.js';

describe('LoopEventLog', () => {
  it('maintains a verifiable hash chain', async () => {
    const root = await mkdtemp(join(tmpdir(), 'eamilos-loop-events-'));
    const log = new LoopEventLog(root);
    await log.append({ missionId: 'm1', iteration: 1, phase: 'OBSERVE', type: 'loop.started' });
    await log.append({ missionId: 'm1', iteration: 1, phase: 'INTERPRET', type: 'interpret.completed', payload: { action: 'EXECUTE' } });
    expect(await log.verify('m1')).toBe(true);
    const events = await log.all('m1');
    expect(events).toHaveLength(2);
    expect(events[1].previousEventHash).toBe(events[0].hash);
  });
});
