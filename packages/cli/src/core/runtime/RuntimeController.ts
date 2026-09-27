import { RuntimeEventLog } from './RuntimeEventLog.js';
import { RuntimePolicyGuard } from './RuntimePolicy.js';
import { RuntimeStateStore } from './RuntimeStateStore.js';
import type { RuntimeDriver, RuntimeEventType, RuntimePolicy, RuntimeSnapshot, RuntimeState, RuntimeStatus } from './types.js';

const transitions:Record<RuntimeState,RuntimeState[]>={
 CREATED:['STARTING','ABORTED'],STARTING:['PLANNING','RECOVERING','FAILED','STOPPING'],
 PLANNING:['SCHEDULING','REPLANNING','RECOVERING','STOPPING'],SCHEDULING:['EXECUTING','WAITING','RECOVERING','STOPPING'],
 EXECUTING:['VALIDATING','RECOVERING','REPLANNING','FAILED','STOPPING'],VALIDATING:['PLANNING','COMPLETED','RECOVERING','REPLANNING','FAILED','STOPPING'],
 RECOVERING:['REPLANNING','SCHEDULING','ESCALATED','FAILED','STOPPING'],REPLANNING:['SCHEDULING','ESCALATED','FAILED','STOPPING'],
 WAITING:['SCHEDULING','RECOVERING','STOPPING'],PAUSED:['STARTING','STOPPING'],ESCALATED:['STARTING','STOPPING'],
 COMPLETED:[],FAILED:['RECOVERING'],ABORTED:[],STOPPING:['PAUSED']
};

export class RuntimeController {
 private snapshot!:RuntimeSnapshot;
 private stagnant=0;
 constructor(private readonly driver:RuntimeDriver,private readonly store:RuntimeStateStore,private readonly events:RuntimeEventLog,private readonly policy:RuntimePolicy){}
 async start(missionId:string):Promise<RuntimeStatus>{
  const restored=await this.store.load(missionId);
  if(restored){this.snapshot=restored;if(restored.state==='PAUSED'||restored.state==='RECOVERING'||restored.state==='REPLANNING'||restored.state==='STARTING')return this.runUntilStable();return this.status();}
  this.snapshot={version:1,missionId,state:'CREATED',health:'HEALTHY',counters:{executions:0,retries:0,replans:0,jevDecisions:0,layaPlans:0,costUsd:0,startedAt:new Date().toISOString()},activeExecutions:[],updatedAt:new Date().toISOString()};
  await this.persistEvent('runtime.started','runtime');await this.transition('STARTING','runtime');return this.runUntilStable();
 }
 resume(missionId:string){return this.start(missionId);}
 async pause(missionId:string){this.assertMission(missionId);if(!['PLANNING','SCHEDULING','WAITING','VALIDATING','RECOVERING','REPLANNING'].includes(this.snapshot.state))throw new Error('Cannot pause from '+this.snapshot.state);await this.transition('PAUSED','runtime');await this.persistEvent('runtime.paused','runtime');}
 async stop(missionId:string){this.assertMission(missionId);if(['COMPLETED','ABORTED'].includes(this.snapshot.state))return;await this.transition('STOPPING','runtime');await this.persistEvent('runtime.stopping','runtime');await this.persist();}
 async recover(missionId:string){this.assertMission(missionId);await this.transition('RECOVERING','runtime');this.snapshot.health='RECOVERING';await this.persistEvent('recovery.started','runtime');if(this.snapshot.activeExecutions.length===0){await this.transition('REPLANNING','runtime');}else{const result=await this.driver.recover?.(missionId,{executionId:this.snapshot.activeExecutions[0],taskId:'unknown',status:'RECOVERABLE'});if(!result?.recovered){this.snapshot.health='DEGRADED';await this.transition('ESCALATED','runtime');}else{this.snapshot.activeExecutions=[];await this.transition('REPLANNING','runtime');}}await this.persistEvent('runtime.recovered','runtime');await this.persist();return this.status();}
 status():RuntimeStatus{return {snapshot:{...this.snapshot,counters:{...this.snapshot.counters},activeExecutions:[...this.snapshot.activeExecutions]},recentEvents:[]};}
 private async runUntilStable():Promise<RuntimeStatus>{
  for(;;){
   if(['COMPLETED','ABORTED','PAUSED','ESCALATED','STOPPING'].includes(this.snapshot.state))return this.status();
   const budget=new RuntimePolicyGuard(this.policy).check(this.snapshot.counters);
   if(!budget.allowed){this.snapshot.health='BLOCKED';await this.persistEvent('budget.exhausted','runtime',{reason:budget.reason});await this.transition('ESCALATED','runtime');return this.status();}
   if(this.snapshot.state==='STARTING'||this.snapshot.state==='REPLANNING'){await this.transition('PLANNING','runtime');continue;}
   if(this.snapshot.state==='PLANNING'){await this.persistEvent('planning.requested','runtime');const plan=await this.driver.plan(this.snapshot.missionId);if(plan.replanned)this.snapshot.counters.replans++;if(!plan.planned){this.snapshot.health='BLOCKED';await this.transition('ESCALATED','runtime');continue;}await this.persistEvent('planning.completed','runtime',{message:plan.message});await this.transition('SCHEDULING','runtime');continue;}
   if(this.snapshot.state==='SCHEDULING'){await this.persistEvent('scheduling.requested','runtime');const schedule=await this.driver.schedule(this.snapshot.missionId);if(!schedule.scheduled||!schedule.taskId){this.stagnant++;if(this.stagnant>=this.policy.maxStagnantIterations){this.snapshot.health='BLOCKED';await this.transition('ESCALATED','runtime');}else await this.transition('WAITING','runtime');continue;}this.stagnant=0;this.snapshot.activeExecutions=[schedule.taskId];await this.transition('EXECUTING','runtime');continue;}
   if(this.snapshot.state==='WAITING'){if(await this.driver.isComplete(this.snapshot.missionId)){await this.transition('COMPLETED','runtime');}else await this.transition('SCHEDULING','runtime');continue;}
   if(this.snapshot.state==='EXECUTING'){const taskId=this.snapshot.activeExecutions[0];if(!taskId){await this.transition('RECOVERING','runtime');continue;}this.snapshot.counters.executions++;await this.persistEvent('execution.started','runtime',{taskId});const result=await this.driver.execute(this.snapshot.missionId,taskId);this.snapshot.activeExecutions=[];if(result.costUsd)this.snapshot.counters.costUsd+=result.costUsd;
    if(result.status==='COMPLETED'){await this.persistEvent('execution.completed','runtime',{taskId,executionId:result.executionId});await this.transition('VALIDATING','runtime');const validation=await this.driver.validate(this.snapshot.missionId,taskId,result);if(validation.passed){await this.persistEvent('validation.passed','runtime',{taskId});if(await this.driver.isComplete(this.snapshot.missionId))await this.transition('COMPLETED','runtime');else await this.transition('SCHEDULING','runtime');}else{await this.persistEvent('validation.failed','runtime',{taskId,checks:validation.checks});this.snapshot.counters.replans++;await this.transition('REPLANNING','runtime');}continue;}
    if(result.status==='QUOTA_EXHAUSTED'||result.status==='RECOVERABLE'||result.status==='WORKER_LOST'){this.snapshot.counters.retries++;if(result.checkpointId)this.snapshot.lastCheckpointId=result.checkpointId;await this.persistEvent(result.status==='QUOTA_EXHAUSTED'?'harness.quota_exhausted':'execution.recovered','runtime',{taskId,checkpointId:result.checkpointId});await this.transition('RECOVERING','runtime');continue;}
    await this.persistEvent('execution.failed','runtime',{taskId});await this.transition('REPLANNING','runtime');continue;
   }
   if(this.snapshot.state==='RECOVERING'){const taskId=this.snapshot.activeExecutions[0];if(taskId&&this.driver.recover){const result=await this.driver.recover(this.snapshot.missionId,{executionId:'recovery',taskId,status:'RECOVERABLE'});if(!result.recovered){this.snapshot.health='DEGRADED';await this.transition('ESCALATED','runtime');continue;}}this.snapshot.activeExecutions=[];await this.persistEvent('recovery.completed','runtime');await this.transition('REPLANNING','runtime');continue;}
  }
 }
 private async transition(to:RuntimeState,actor:string){const from=this.snapshot.state;if(!transitions[from].includes(to))throw new Error('Invalid runtime transition '+from+' -> '+to);this.snapshot.state=to;this.snapshot.updatedAt=new Date().toISOString();await this.persistEvent('mission.observed',actor,{from,to});await this.persist();}
 private async persistEvent(type:RuntimeEventType,actor:string,payload:Record<string,unknown>={}){const event=await this.events.append({missionId:this.snapshot.missionId,type,actor,payload});this.snapshot.lastEventId=event.eventId;this.snapshot.updatedAt=event.timestamp;await this.persist();}
 private async persist(){await this.store.save(this.snapshot);}
 private assertMission(id:string){if(!this.snapshot||this.snapshot.missionId!==id)throw new Error('Runtime mission mismatch');}
}
