import { createHash, randomUUID } from 'node:crypto';
import type { DistributedEventLog } from '../comms/a2a/EamilosDistributedEventLog.js';
import type { FleetRegistry, FleetWorker } from '../comms/a2a/EamilosFleetRegistry.js';
import type { ResourceLeaseManager } from '../comms/a2a/EamilosResourceLeaseManager.js';
import type { MissionControlPlane } from '../mission-control/MissionControl.js';
import type { TaskNode, TaskPriority } from '../mission/types.js';
import { InMemorySchedulerStore } from './GlobalSchedulerStore.js';
import type { GlobalSchedulerOptions, ScheduleDecision, SchedulingCandidate, SchedulerDispatcher, SchedulerStore } from './GlobalSchedulerTypes.js';

const PRIORITY:Record<TaskPriority,number>={CRITICAL:0,HIGH:1,MEDIUM:2,LOW:3};

export class GlobalScheduler {
  readonly store:SchedulerStore;
  private readonly missionControl:MissionControlPlane; private readonly fleet:FleetRegistry; private readonly leases:ResourceLeaseManager;
  private readonly eventLog?:DistributedEventLog; private readonly dispatcher?:SchedulerDispatcher;
  private readonly constraints:Required<Pick<NonNullable<GlobalSchedulerOptions['constraints']>,'maxGlobalExecutions'|'maxPerWorker'|'allowStaleWorkers'>>;
  private readonly leaseTtlMs:number; private readonly leaseRenewalThresholdMs:number;
  private readonly ownedStore:boolean;

  constructor(options:GlobalSchedulerOptions){
    this.missionControl=options.missionControl;this.fleet=options.fleet;this.leases=options.leases;this.eventLog=options.eventLog;this.dispatcher=options.dispatcher;
    const c=options.constraints??{};this.constraints={maxGlobalExecutions:c.maxGlobalExecutions??Number.MAX_SAFE_INTEGER,maxPerWorker:c.maxPerWorker??Number.MAX_SAFE_INTEGER,allowStaleWorkers:c.allowStaleWorkers??false};
    this.leaseTtlMs=Math.max(1000,Math.floor(c.leaseTtlMs??300_000));
    this.leaseRenewalThresholdMs=Math.min(this.leaseTtlMs-1,Math.max(100,Math.floor(c.leaseRenewalThresholdMs??Math.floor(this.leaseTtlMs/3))));
    this.ownedStore=!options.store;this.store=options.store??new InMemorySchedulerStore();this.recover();
  }

  cycle():ScheduleDecision[]{
    this.fleet.refreshStatuses();const active=this.store.listActive();const capacity=Math.max(0,this.constraints.maxGlobalExecutions-active.length);
    this.emit('scheduler.cycle.started',undefined,{activeDecisionCount:active.length});
    if(capacity===0){this.emit('scheduler.cycle.completed',undefined,{selected:0});return[];}
    const candidates=this.candidates().sort(compareCandidates);const selected:ScheduleDecision[]=[];const workerReservations=new Map<string,number>();
    for(const d of active)workerReservations.set(d.workerId,(workerReservations.get(d.workerId)??0)+1);
    for(const candidate of candidates){
      if(selected.length>=capacity)break;
      const idempotencyKey=decisionKey(candidate);if(this.store.getByIdempotencyKey(idempotencyKey))continue;
      const workers=this.fleet.find(candidate.requiredCapabilities,{includeStale:this.constraints.allowStaleWorkers});
      const worker=workers.find(w=>(workerReservations.get(w.workerId)??0)<Math.min(w.capacity,this.constraints.maxPerWorker));if(!worker)continue;
      const executionId=`execution_${randomUUID()}`;let lease;
      try{lease=this.leases.acquire({executionId,ownerId:`scheduler:${executionId}`,resources:candidate.resources,ttlMs:this.leaseTtlMs});}
      catch(error){this.emit('scheduler.resource_conflict',candidate,{error:String(error)});continue;}
      const now=new Date().toISOString();const revision=this.store.nextRevision();
      const decision:ScheduleDecision={decisionId:`decision_${randomUUID()}`,idempotencyKey,schedulerRevision:revision,missionId:candidate.missionId,taskId:candidate.taskId,executionId,workerId:worker.workerId,agentId:worker.agentId,harnessId:worker.harnessId,priority:candidate.task.priority,fencingToken:lease.fencingToken,leaseId:lease.leaseId,state:'scheduled',createdAt:now,updatedAt:now};
      try{this.store.saveDecision(decision);}catch(error){try{this.leases.release(lease.leaseId,`scheduler:${executionId}`,lease.fencingToken);}catch{/* cleanup */}this.emit('scheduler.decision.rejected',candidate,{reason:String(error)});continue;}
      workerReservations.set(worker.workerId,(workerReservations.get(worker.workerId)??0)+1);selected.push(decision);this.emit('scheduler.decision.created',candidate,{decision});
    }
    this.emit('scheduler.cycle.completed',undefined,{selected:selected.length});return selected;
  }

  async dispatch(decisionId:string):Promise<ScheduleDecision>{
    const decision=this.store.getDecision(decisionId);if(!decision)throw new Error('SCHEDULER_DECISION_NOT_FOUND');if(decision.state!=='scheduled')return decision;
    const candidate=this.candidate(decision.missionId,decision.taskId);const worker=this.fleet.get(decision.workerId);
    if(!candidate||!worker){this.releaseAndReject(decision,'SCHEDULER_DISPATCH_TARGET_GONE');throw new Error('SCHEDULER_DISPATCH_TARGET_GONE');}
    try{if(!this.dispatcher)throw new Error('SCHEDULER_DISPATCHER_NOT_CONFIGURED');await this.dispatcher.dispatch(decision,candidate,worker);this.store.updateDecision(decisionId,{state:'dispatched'});this.emit('scheduler.dispatch.accepted',candidate,{decisionId,workerId:worker.workerId});return this.store.getDecision(decisionId)!;}
    catch(error){this.releaseAndReject(decision,String(error));this.emit('scheduler.dispatch.rejected',candidate,{decisionId,error:String(error)});throw error;}
  }

  complete(executionId:string,state:'completed'|'failed'|'cancelled'='completed'):ScheduleDecision{
    const decision=this.store.snapshot().decisions.find(d=>d.executionId===executionId);if(!decision)throw new Error('SCHEDULER_EXECUTION_NOT_FOUND');
    if(['completed','failed','cancelled','rejected','rescheduled'].includes(decision.state))return decision;
    try{this.leases.release(decision.leaseId,`scheduler:${executionId}`,decision.fencingToken);}catch(error){if(this.leases.get(decision.leaseId))throw error;}
    const updated=this.store.updateDecision(decision.decisionId,{state});this.emit(`scheduler.execution.${state}`,this.candidate(decision.missionId,decision.taskId),{decision:updated});return updated;
  }

  renewLeases(now=Date.now()):ScheduleDecision[]{
    this.fleet.refreshStatuses(now);
    const renewed:ScheduleDecision[]=[];
    for(const decision of this.store.listActive()){
      const lease=this.leases.get(decision.leaseId,now);
      if(!lease)continue;
      if(Date.parse(lease.expiresAt)-now>this.leaseRenewalThresholdMs)continue;
      const worker=this.fleet.get(decision.workerId);
      const unavailable=!worker||worker.status==='offline'||(!this.constraints.allowStaleWorkers&&worker.status==='stale');
      if(unavailable)continue;
      try{
        const next=this.leases.renew(decision.leaseId,'scheduler:'+decision.executionId,decision.fencingToken,this.leaseTtlMs,now);
        renewed.push(decision);
        this.emit('scheduler.lease.renewed',this.candidate(decision.missionId,decision.taskId),{decision,expiresAt:next.expiresAt});
      }catch(error){
        this.emit('scheduler.lease.renewal_failed',this.candidate(decision.missionId,decision.taskId),{decisionId:decision.decisionId,error:String(error)});
      }
    }
    return renewed;
  }

  reconcile():ScheduleDecision[]{
    this.fleet.refreshStatuses();
    const recovered:ScheduleDecision[]=[];
    for(const decision of this.store.listActive()){
      const worker=this.fleet.get(decision.workerId);
      const lease=this.leases.get(decision.leaseId);
      if(!lease){
        const recoveryKey=`${decision.idempotencyKey}:recovery:${this.store.nextRevision()}`;
        const updated=this.store.updateDecision(decision.decisionId,{state:'rescheduled',idempotencyKey:recoveryKey,reason:'SCHEDULER_LEASE_MISSING'});
        recovered.push(updated);this.emit('scheduler.execution.rescheduled',this.candidate(decision.missionId,decision.taskId),{decision:updated});continue;
      }
      const unavailable=!worker || worker.status==='offline' || (!this.constraints.allowStaleWorkers && worker.status==='stale');
      if(unavailable){
        try{this.leases.release(decision.leaseId,`scheduler:${decision.executionId}`,decision.fencingToken);}catch{/* cleanup */}
        const recoveryKey=`${decision.idempotencyKey}:recovery:${this.store.nextRevision()}`;
        const updated=this.store.updateDecision(decision.decisionId,{state:'rescheduled',idempotencyKey:recoveryKey,reason:'SCHEDULER_WORKER_LOST'});
        recovered.push(updated);this.emit('scheduler.execution.rescheduled',this.candidate(decision.missionId,decision.taskId),{decision:updated});
      }
    }
    return recovered;
  }

  refresh():ScheduleDecision[]{return this.store.listActive();}
  snapshot(){return this.store.snapshot();}
  close(){if(this.ownedStore)this.store?.close?.();}

  private recover():void{for(const decision of this.store.listActive()){if(!this.leases.get(decision.leaseId))this.store.updateDecision(decision.decisionId,{state:'rejected',reason:'SCHEDULER_LEASE_MISSING_AFTER_RECOVERY'});}}
  private releaseAndReject(decision:ScheduleDecision,reason:string):void{try{this.leases.release(decision.leaseId,`scheduler:${decision.executionId}`,decision.fencingToken);}catch{/* cleanup */}this.store.updateDecision(decision.decisionId,{state:'rejected',reason});}
  private candidates():SchedulingCandidate[]{const out:SchedulingCandidate[]=[];for(const mission of this.missionControl.list({status:'active'}))for(const task of this.missionControl.readyTasks(mission.missionId))out.push(this.makeCandidate(mission.missionId,task,mission.createdAt));return out;}
  private candidate(missionId:string,taskId:string):SchedulingCandidate|undefined{const mission=this.missionControl.get(missionId);if(!mission)return undefined;const task=this.missionControl.snapshot(missionId).tasks.find(t=>t.id===taskId);return task?this.makeCandidate(missionId,task,mission.createdAt):undefined;}
  private makeCandidate(missionId:string,task:TaskNode,createdAt:string):SchedulingCandidate{return{missionId,taskId:task.id,task,missionCreatedAt:createdAt,priorityRank:PRIORITY[task.priority],requiredCapabilities:[...task.requiredCapabilities].sort(),resources:resourcesFromTask(task)};}
  private emit(type:string,candidate:SchedulingCandidate|undefined,payload:Record<string,unknown>){if(!this.eventLog)return;const d=payload.decision as ScheduleDecision|undefined;const stable=d?.decisionId??`${type}:${candidate?.missionId??''}:${candidate?.taskId??''}`;const id=createHash('sha256').update(stable).digest('hex');this.eventLog.append({eventId:id,eventType:type,missionId:candidate?.missionId,taskId:candidate?.taskId,executionId:d?.executionId,workerId:(payload.workerId as string|undefined),occurredAt:new Date().toISOString(),payload});}
}

function compareCandidates(a:SchedulingCandidate,b:SchedulingCandidate):number{return a.priorityRank-b.priorityRank||a.task.createdAt.localeCompare(b.task.createdAt)||a.missionCreatedAt.localeCompare(b.missionCreatedAt)||a.missionId.localeCompare(b.missionId)||a.taskId.localeCompare(b.taskId);}
function decisionKey(c:SchedulingCandidate):string{return createHash('sha256').update(`${c.missionId}:${c.taskId}:${c.task.updatedAt}:${c.task.attempt}`).digest('hex');}
function resourcesFromTask(task:TaskNode):{readSet:string[];writeSet:string[]}{const value=task.inputs.resources;if(!value||typeof value!=='object')return{readSet:[],writeSet:[]};const r=value as Record<string,unknown>;return{readSet:strings(r.readSet),writeSet:strings(r.writeSet)};}
function strings(v:unknown):string[]{return Array.isArray(v)?v.filter((x):x is string=>typeof x==='string'&&x.trim().length>0).map(x=>x.trim()).sort():[];}
