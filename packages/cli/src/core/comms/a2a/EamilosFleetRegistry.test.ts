import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EamilosInMemoryFleetRegistry, EamilosSqliteFleetRegistry, FleetRegistryConflictError, type FleetRegistry } from './EamilosFleetRegistry.js';
import type { AgentCard } from './EamilosA2AProtocol.js';

const card=(id:string, caps=['code.execution']):AgentCard=>({
  kind:'agent.card',protocolVersion:1,workerId:id,agentId:`agent-${id}`,harnessId:`harness-${id}`,
  name:id,description:'test',endpoint:`http://127.0.0.1:${id==='w1'?10001:10002}`,capabilities:caps,maxConcurrency:4,
  streaming:true,checkpointResume:true,authentication:[],metadata:{region:'local'},advertisedAt:new Date().toISOString()
});

function exercise(r:FleetRegistry){
  const w=r.register(card('w1')); expect(w.status).toBe('online'); expect(w.capacity).toBe(4); expect(w.revision).toBe(1);
  const hb=r.heartbeat({workerId:'w1',timestamp:new Date(Date.parse(w.lastHeartbeatAt)+1000).toISOString(),activeExecutions:2,capacity:2,sequence:1});
  expect(hb.capacity).toBe(2); expect(hb.heartbeatSequence).toBe(1);
  expect(()=>r.heartbeat({workerId:'w1',timestamp:hb.lastHeartbeatAt,activeExecutions:2,capacity:2,sequence:1})).toThrow(FleetRegistryConflictError);
  expect(r.find(['code.execution'])).toHaveLength(1); expect(r.find(['missing'])).toHaveLength(0);
  expect(r.refreshStatuses(Date.parse(hb.lastHeartbeatAt)+31_000).find(x=>x.workerId==='w1')?.status).toBe('stale');
  expect(r.refreshStatuses(Date.parse(hb.lastHeartbeatAt)+121_000).find(x=>x.workerId==='w1')?.status).toBe('offline');
  expect(r.find(['code.execution'])).toHaveLength(0); expect(r.unregister('w1')?.status).toBe('offline');
}

describe('EamilOS Fleet Registry',()=>{
  it('tracks workers in memory',()=>exercise(new EamilosInMemoryFleetRegistry({staleAfterMs:30_000,offlineAfterMs:120_000})));
  it('persists registration and heartbeat state across restart',()=>{
    const d=mkdtempSync(join(tmpdir(),'eamilos-fleet-')); const f=join(d,'fleet.sqlite');
    try {
      const r=new EamilosSqliteFleetRegistry({filename:f,staleAfterMs:30_000,offlineAfterMs:120_000}); exercise(r); r.register(card('w2',['python'])); r.close();
      const recovered=new EamilosSqliteFleetRegistry({filename:f,staleAfterMs:30_000,offlineAfterMs:120_000});
      expect(recovered.get('w2')?.capabilities).toEqual(['python']); expect(recovered.get('w1')?.heartbeatSequence).toBe(1); recovered.close();
    } finally { rmSync(d,{recursive:true,force:true}); }
  });
  it('rejects identity conflicts and unknown workers',()=>{
    const r=new EamilosInMemoryFleetRegistry(); r.register(card('w1'));
    expect(()=>r.register({...card('w1'),agentId:'other'})).toThrow('WORKER_IDENTITY_CONFLICT');
    expect(()=>r.heartbeat({workerId:'missing',timestamp:new Date().toISOString(),activeExecutions:0,capacity:1,sequence:1})).toThrow('UNKNOWN_WORKER');
  });
});
