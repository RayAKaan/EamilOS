import { createHash, randomUUID } from 'node:crypto';
import type { DistributedEventLog } from '../comms/a2a/EamilosDistributedEventLog.js';
import type { FleetRegistry, FleetWorker } from '../comms/a2a/EamilosFleetRegistry.js';
import type { ResourceLeaseManager } from '../comms/a2a/EamilosResourceLeaseManager.js';
import type { MissionControlPlane } from '../mission-control/MissionControl.js';
import type { TaskNode, TaskPriority } from '../mission/types.js';
import { InMemorySchedulerStore } from './GlobalSchedulerStore.js';
import type { GlobalSchedulerOptions, ScheduleDecision, SchedulingCandidate, SchedulerDispatcher } from './GlobalSchedulerTypes.js';

const PRIORITY:Record<TaskPriority,number>={CRITICAL:0,HIGH:1,MEDIUM:2,LOW:3};

export class GlobalScheduler {
  readonly store:GlobalSchedulerOptions['store'];
  private readonly missionControl:MissionControlPlane;
  private readonly fleet:FleetRegistry;
  private readonly leases:ResourceLeaseManager;
  private readonly eventLog?:DistributedEventLog;
  private readonly dispatcher?:SchedulerDispatcher;
  private readonly constraints:Required<Pick<NonNullable<GlobalSchedulerOptions['constraints']>,'maxGlobalExecutions'|'maxPerWorker'|'allowStaleWorkers'>>;
  private readonly ownedStore:boolean;

  constructor(options:GlobalSchedulerOptions){
    this.missionControl=options.missionControl;this.fleet=options.fleet;this.leases=options.leases;this.eventLog=options.eventLog;this.dispatcher=options.dispatcher;
    const c=options.constraints??{};this.constraints={maxGlobalExecutions:c.maxGlobalExecutions??Number.MAX_SAFE_INTEGER,maxPerWorker:c.maxPerWorker??Number.MAX_SAFE_INTEGER,allowStaleWorkers:c.allowStaleWorkers??false};
    this.ownedStore=!options.store;this.store=options.store??new InMemorySchedulerStore();
  }

  cycle():ScheduleDecision[]{
    this.fleet.refreshStatuses();
    const active=this.store.listActive();
    const capacity=Math.max(0,this.constraints.maxGlobalExecutions-active.length);
    if(capacity===0)return[];
    const candidates=this.candidates().sort(compareCandidates);
    const selected:ScheduleDecision[]=[];
    const workerReservations=new Map<string,number>();
    for(const d of active)workerReservations.set(d.workerId,(workerReservations.get(d.workerId)??0)+1);

    for(const candidate of candidates){
      if(selected.length>=capacity)break;
      const idempotencyKey=decisionKey(candidate);
      const existing=this.store.getByIdempotencyKey(idempotencyKey);
      if(existing)continue;
      const workers=this.fleet.find(candidate.requiredCapabilities,{includeStale:this.constraints.allowStaleWorkers});
      const worker=workers.find(w=>(workerReservations.get(w.workerId)??0)<Math.min(w.capacity,this.constraints.maxPerWorker));
      if(!worker)continue;
      const executionId=`execution_${randomUUID()}`;
      const resources=candidate.resources;
      let lease;
      try{lease=this.leases.acquire({executionId,ownerId:`scheduler:${executionId}`,resources,ttlMs:300_000});}
      catch(error){this.emit('scheduler.resource_conflict',candidate,{error:String(error)});continue;}
      const now=new Date().toISOString();
      const revision=this.store.nextRevision();
      const decision:ScheduleDecision={decisionId:`decision_${randomUUID()}`,idempotencyKey,schedulerRevision:revision,missionId:candidate.missionId,taskId:candidate.taskId,executionId,workerId:worker.workerId,agentId:worker.agentId,harnessId:worker.harnessId,priority:candidate.task.priority,fencingToken:lease.fencingToken,leaseId:lease.leaseId,state:'scheduled',createdAt:now,updatedAt:now};
      this.store.saveDecision(decision);workerReservations.set(worker.workerId,(workerReservations.get(worker.workerId)??0)+1);selected.push(decision);
      this.emit('scheduler.decision.created',candidate,{decision});
    }
    return selected;
  }

  async dispatch(decisionId:string):Promise<ScheduleDecision>{
    const decision=this.store.getDecision(decisionId);if(!decision)throw new Error('SCHEDULER_DECISION_NOT_FOUND');if(decision.state!=='scheduled')return decision;
    const candidate=this.candidate(decision.missionId,decision.taskId);const worker=this.fleet.get(decision.workerId);if(!candidate||!worker)throw new Error('SCHEDULER_DISPATCH_TARGET_GONE');
    try{if(this.dispatcher)await this.dispatcher.dispatch(decision,candidate,worker);this.store.updateDecision(decisionId,{state:'dispatched'});this.emit('scheduler.dispatch.accepted',candidate,{decisionId,workerId:worker.workerId});return this.store.getDecision(decisionId)!;}
    catch(error){this.leases.release(decision.leaseId,`scheduler:${decision.executionId}`,decision.fencingToken);this.store.updateDecision(decisionId,{state:'rejected',reason:String(error)});this.emit('scheduler.dispatch.rejected',candidate,{decisionId,error:String(error)});throw error;}
  }

  complete(executionId:string,state:'completed'|'failed'|'cancelled'='completed'):ScheduleDecision{
    const decision=this.store.snapshot().decisions.find(d=>d.executionId===executionId);if(!decision)throw new Error('SCHEDULER_EXECUTION_NOT_FOUND');
    if(['completed','failed','cancelled','rejected'].includes(decision.state))return decision;
    this.leases.release(decision.leaseId,`scheduler:${executionId}`,decision.fencingToken);
    const updated=this.store.updateDecision(decision.decisionId,{state});
    this.emit(`scheduler.execution.${state}`,this.candidate(decision.missionId,decision.taskId),{decision:updated});
    return updated;
  }

  refresh():ScheduleDecision[]{return this.store.listActive();}
  snapshot(){return this.store.snapshot();}
  close(){if(this.ownedStore)this.store?.close?.();}

  private candidates():SchedulingCandidate[]{const out:SchedulingCandidate[]=[];for(const mission of this.missionControl.list({status:'active'})){for(const task of this.missionControl['engineReadyTasks']?.(mission.missionId)??[])out.push(this.makeCandidate(mission.missionId,task,mission.createdAt));}return out;}
  private candidate(missionId:string,taskId:string):SchedulingCandidate|undefined{const mission=this.missionControl.get(missionId);if(!mission)return undefined;const task=this.missionControl['engineSnapshot']?.(missionId)?.tasks.find((t:TaskNode)=>t.id===taskId);return task?this.makeCandidate(missionId,task,mission.createdAt):undefined;}
  private makeCandidate(missionId:string,task:TaskNode,createdAt:string):SchedulingCandidate{return{missionId,taskId:task.id,task,missionCreatedAt:createdAt,priorityRank:PRIORITY[task.priority],requiredCapabilities:[...task.requiredCapabilities].sort(),resources:resourcesFromTask(task)};}
  private emit(type:string,candidate:SchedulingCandidate|undefined,payload:Record<string,unknown>){if(!this.eventLog)return;const id=createHash('sha256').update(`${type}:${candidate?.missionId??''}:${candidate?.taskId??''}:${JSON.stringify(payload)}`).digest('hex');this.eventLog.append({eventId:id,eventType:type,missionId:candidate?.missionId,taskId:candidate?.taskId,executionId:payload.decision&&typeof payload.decision==='object'?(payload.decision as ScheduleDecision).executionId:undefined,workerId:payload.workerId as string|undefined,occurredAt:new Date().toISOString(),payload});}
}

function compareCandidates(a:SchedulingCandidate,b:SchedulingCandidate):number{return a.priorityRank-b.priorityRank||a.task.createdAt.localeCompare(b.task.createdAt)||a.missionCreatedAt.localeCompare(b.missionCreatedAt)||a.missionId.localeCompare(b.missionId)||a.taskId.localeCompare(b.taskId);}
function decisionKey(c:SchedulingCandidate):string{return createHash('sha256').update(`${c.missionId}:${c.taskId}:${c.task.updatedAt}:${c.task.attempt}`).digest('hex');}
function resourcesFromTask(task:TaskNode):{readSet:string[];writeSet:string[]}{const value=task.inputs.resources;if(!value||typeof value!=='object')return{readSet:[],writeSet:[]};const r=value as Record<string,unknown>;return{readSet:strings(r.readSet),writeSet:strings(r.writeSet)};}
function strings(v:unknown):string[]{return Array.isArray(v)?v.filter((x):x is string=>typeof x==='string'&&x.trim().length>0).map(x=>x.trim()).sort():[];}
