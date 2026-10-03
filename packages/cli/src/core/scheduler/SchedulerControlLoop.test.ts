import { describe, expect, it } from 'vitest';
import { SchedulerControlLoop } from './SchedulerControlLoop.js';
import type { ScheduleDecision } from './GlobalSchedulerTypes.js';

const decision=(id:string):ScheduleDecision=>({decisionId:id,idempotencyKey:id,schedulerRevision:1,missionId:'m1',taskId:'t1',executionId:`e-${id}`,workerId:'w1',agentId:'a1',harnessId:'h1',priority:'MEDIUM',fencingToken:1,leaseId:`l-${id}`,state:'scheduled',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
function fake(){const calls:string[]=[];const scheduler={renewLeases:()=>[decision('r-lease')],reconcile:()=>[decision('r')],cycle:()=>[decision('s1'),decision('s2')],dispatch:async(id:string)=>{calls.push(id);return decision(id)}} as any;return{scheduler,calls};}
describe('SchedulerControlLoop',()=>{
 it('reconciles, schedules and dispatches in one tick',async()=>{const f=fake();const report=await new SchedulerControlLoop({scheduler:f.scheduler}).tick();expect(report.renewed).toHaveLength(1);expect(report.rescheduled).toHaveLength(1);expect(report.scheduled).toHaveLength(2);expect(report.dispatched.map(d=>d.decisionId)).toEqual(['s1','s2']);expect(f.calls).toEqual(['s1','s2']);});
 it('expires due approvals before scheduler reconciliation',async()=>{
  const f=fake();
  let called=0;
  const approvalExpiry={expireDue:()=>{called+=1;return{now:'2026-10-03T11:00:00.000Z',scanned:1,expired:[{approvalId:'approval-1'}],conflicts:[]}}};
  const report=await new SchedulerControlLoop({scheduler:f.scheduler,approvalExpiry:approvalExpiry as any}).tick();
  expect(called).toBe(1);
  expect(report.expiredApprovals).toEqual(['approval-1']);
  expect(report.rescheduled).toHaveLength(1);
});
 it('limits dispatches per tick',async()=>{const f=fake();const report=await new SchedulerControlLoop({scheduler:f.scheduler,maxDispatchPerTick:1}).tick();expect(report.dispatched).toHaveLength(1);});
 it('does not overlap ticks',async()=>{let release!:()=>void;const wait=new Promise<void>(r=>{release=r});let entered=0;const scheduler={renewLeases:()=>[],reconcile:()=>{entered+=1;return[]},cycle:()=>[decision('x')],dispatch:async()=>{await wait;return decision('x')}} as any;const loop=new SchedulerControlLoop({scheduler});const first=loop.tick();const second=await loop.tick();expect(second.scheduled).toHaveLength(0);release();await first;expect(entered).toBe(1);});
 it('captures dispatch failures without stopping the loop',async()=>{const scheduler={renewLeases:()=>[],reconcile:()=>[],cycle:()=>[decision('bad'),decision('good')],dispatch:async(id:string)=>{if(id==='bad')throw new Error('boom');return decision(id)}} as any;const report=await new SchedulerControlLoop({scheduler}).tick();expect(report.failedDispatches).toEqual([{decisionId:'bad',error:'Error: boom'}]);expect(report.dispatched[0].decisionId).toBe('good');});
});
