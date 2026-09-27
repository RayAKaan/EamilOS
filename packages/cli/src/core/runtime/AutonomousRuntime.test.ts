import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AutonomousRuntime } from './AutonomousRuntime.js';
import type { RuntimeDriver, RuntimePolicy } from './types.js';

const policy:RuntimePolicy={budget:{maxExecutions:10,maxRetries:5,maxReplans:5,maxCostUsd:10},maxStagnantIterations:2,maxRuntimeEvents:1000,allowAutonomousExecution:true};

async function fixture(recover:boolean){
 const root=await mkdtemp(join(tmpdir(),'eamilos-runtime-'));let executions=0;
 const driver:RuntimeDriver={
  async plan(){return {planned:true};},
  async schedule(){return {scheduled:true,taskId:'task-1'};},
  async execute(){executions++;if(recover&&executions===1)return {executionId:'e1',taskId:'task-1',status:'QUOTA_EXHAUSTED',checkpointId:'cp-1'};return {executionId:'e'+executions,taskId:'task-1',status:'COMPLETED'};},
  async validate(){return {passed:true,checks:[{name:'acceptance',passed:true}]};},
  async recover(){return {recovered:true};},
  async isComplete(){return executions>=(recover?2:1);}
 };
 return {root,driver,get executions(){return executions}};
}

describe('AutonomousRuntime',()=>{
 it('runs planning, execution, validation and completion',async()=>{
  const f=await fixture(false);const runtime=new AutonomousRuntime(f.root,()=>f.driver,policy);const status=await runtime.start('mission-1');
  expect(status.snapshot.state).toBe('COMPLETED');expect(f.executions).toBe(1);
  const events=await runtime.replay('mission-1');expect(events.length).toBeGreaterThan(4);
  await rm(f.root,{recursive:true,force:true});
 });
 it('persists checkpoint metadata across recoverable execution failure',async()=>{
  const f=await fixture(true);const runtime=new AutonomousRuntime(f.root,()=>f.driver,policy);const status=await runtime.start('mission-2');
  expect(status.snapshot.state).toBe('COMPLETED');expect(status.snapshot.counters.retries).toBe(1);expect(status.snapshot.lastCheckpointId).toBe('cp-1');expect(f.executions).toBe(2);
  await rm(f.root,{recursive:true,force:true});
 });
 it('rejects impossible state transitions',async()=>{
  const f=await fixture(false);const runtime=new AutonomousRuntime(f.root,()=>f.driver,policy);await runtime.start('mission-3');
  await expect(runtime.pause('mission-3')).rejects.toThrow('Cannot pause');
  await rm(f.root,{recursive:true,force:true});
 });
});
