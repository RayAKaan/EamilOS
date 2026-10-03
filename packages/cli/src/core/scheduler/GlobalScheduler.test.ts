import { describe, expect, it } from 'vitest';
import { GlobalScheduler } from './GlobalScheduler.js';
import { InMemorySchedulerStore } from './GlobalSchedulerStore.js';
import type { FleetRegistry, FleetWorker } from '../comms/a2a/EamilosFleetRegistry.js';
import type { ResourceLease, ResourceLeaseManager } from '../comms/a2a/EamilosResourceLeaseManager.js';
import type { MissionControlPlane, MissionControlSummary } from '../mission-control/MissionControl.js';

function worker(id:string,caps:string[]=['code']):FleetWorker{return{workerId:id,agentId:`agent-${id}`,harnessId:`harness-${id}`,name:id,description:'',endpoint:`http://${id}.test`,capabilities:caps,maxConcurrency:2,activeExecutions:0,capacity:2,streaming:true,checkpointResume:true,authentication:[],metadata:{},status:'online',advertisedAt:new Date(0).toISOString(),lastHeartbeatAt:new Date().toISOString(),heartbeatSequence:1,revision:1,updatedAt:new Date().toISOString()};}
class FakeFleet{constructor(private readonly ws:FleetWorker[]){}register(){throw new Error('unused')}heartbeat(){throw new Error('unused')}unregister(){return undefined}get(id:string){return this.ws.find(w=>w.workerId===id)}list(){return this.ws}find(caps:string[]=[]){return this.ws.filter(w=>caps.every(c=>w.capabilities.includes(c))&&w.capacity>0).sort((a,b)=>a.workerId.localeCompare(b.workerId))}refreshStatuses(){return this.ws}}
class FakeLeases{n=0;leases=new Map<string,ResourceLease>();acquire(r:any){const lease={leaseId:`lease-${++this.n}`,executionId:r.executionId,ownerId:r.ownerId,resources:r.resources,fencingToken:this.n,acquiredAt:new Date().toISOString(),expiresAt:new Date(Date.now()+r.ttlMs).toISOString()};this.leases.set(lease.leaseId,lease);return lease}renew(id:string,ownerId:string,fencingToken:number,ttlMs:number,now=Date.now()){const l=this.leases.get(id);if(!l)throw new Error('LEASE_NOT_FOUND');if(l.ownerId!==ownerId||l.fencingToken!==fencingToken)throw new Error('LEASE_FENCING_TOKEN_MISMATCH');const next={...l,expiresAt:new Date(now+ttlMs).toISOString()};this.leases.set(id,next);return next}release(id:string){this.leases.delete(id);return true}get(id:string){return this.leases.get(id)}getByExecution(id:string){return [...this.leases.values()].find(l=>l.executionId===id)}reapExpired(){return 0}}
const asFleet=(value:FakeFleet)=>value as unknown as FleetRegistry;
const asLeases=(value:FakeLeases)=>value as unknown as ResourceLeaseManager;
function control(tasks:any[]):MissionControlPlane{const summary={missionId:'m1',goal:'g',workingDir:'/',status:'active',createdAt:'2026-01-01T00:00:00.000Z',updatedAt:'2026-01-01T00:00:00.000Z',revision:1,activeTaskCount:0,totalTaskCount:tasks.length,metadata:{},readyTaskCount:tasks.length,runningTaskCount:0,failedTaskCount:0} as MissionControlSummary;return{list:()=>tasks.length?[summary]:[],get:()=>summary,readyTasks:()=>tasks,snapshot:()=>({mission:summary,tasks,checkpoints:[],evidence:[],events:[]})} as unknown as MissionControlPlane;}
function task(id:string,priority:any='MEDIUM',caps=['code']):any{return{id,missionId:'m1',title:id,description:id,state:'READY',priority,dependencies:[],requiredCapabilities:caps,acceptanceCriteria:[],inputs:{},outputs:{},artifacts:[],evidenceIds:[],attempt:0,maxAttempts:3,idempotencyKey:id,createdAt:'2026-01-01T00:00:00.000Z',updatedAt:'2026-01-01T00:00:00.000Z'};}

describe('GlobalScheduler',()=>{
  it('orders deterministic candidates and reserves leases',()=>{const t=[task('low','LOW'),task('critical','CRITICAL')];const s=new GlobalScheduler({missionControl:control(t),fleet:asFleet(new FakeFleet([worker('w2'),worker('w1')])),leases:asLeases(new FakeLeases()),store:new InMemorySchedulerStore(),constraints:{maxGlobalExecutions:1}});const out=s.cycle();expect(out).toHaveLength(1);expect(out[0].taskId).toBe('critical');expect(out[0].workerId).toBe('w1');});
  it('does not duplicate an already scheduled task',()=>{const t=[task('t')];const s=new GlobalScheduler({missionControl:control(t),fleet:asFleet(new FakeFleet([worker('w1')])),leases:asLeases(new FakeLeases()),store:new InMemorySchedulerStore()});expect(s.cycle()).toHaveLength(1);expect(s.cycle()).toHaveLength(0);});
  it('respects global capacity and worker reservations',()=>{const t=[task('a'),task('b'),task('c')];const s=new GlobalScheduler({missionControl:control(t),fleet:asFleet(new FakeFleet([worker('w1')])),leases:asLeases(new FakeLeases()),store:new InMemorySchedulerStore(),constraints:{maxGlobalExecutions:3,maxPerWorker:1}});expect(s.cycle()).toHaveLength(1);});
  it('releases the fencing lease when dispatch fails',async()=>{const t=[task('t')];const leases=new FakeLeases();const s=new GlobalScheduler({missionControl:control(t),fleet:asFleet(new FakeFleet([worker('w1')])),leases:asLeases(leases),constraints:{maxGlobalExecutions:1},dispatcher:{dispatch:async()=>{throw new Error('dispatch failed')}}});const d=s.cycle()[0];await expect(s.dispatch(d.decisionId)).rejects.toThrow('dispatch failed');expect(leases.leases.size).toBe(0);expect(s.snapshot().decisions[0].state).toBe('rejected');});
  it('renews leases before they approach expiry',()=>{
    const leases=new FakeLeases();
    const s=new GlobalScheduler({missionControl:control([task('t')]),fleet:asFleet(new FakeFleet([worker('w1')])),leases:asLeases(leases),constraints:{leaseTtlMs:1000,leaseRenewalThresholdMs:500}});
    const d=s.cycle()[0];
    const before=leases.leases.get(d.leaseId)!.expiresAt;
    const now=Date.parse(leases.leases.get(d.leaseId)!.expiresAt)-400;
    const renewed=s.renewLeases(now);
    expect(renewed.map(x=>x.executionId)).toEqual([d.executionId]);
    expect(Date.parse(leases.leases.get(d.leaseId)!.expiresAt)).toBe(now+1000);
    expect(before).not.toBe(leases.leases.get(d.leaseId)!.expiresAt);
  });

  it('completes and releases a lease',()=>{const t=[task('t')];const leases=new FakeLeases();const s=new GlobalScheduler({missionControl:control(t),fleet:asFleet(new FakeFleet([worker('w1')])),leases:asLeases(leases)});const d=s.cycle()[0];expect(s.complete(d.executionId,'completed').state).toBe('completed');expect(leases.leases.size).toBe(0);});
});
