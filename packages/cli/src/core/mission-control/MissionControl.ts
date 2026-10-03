import { createHash } from 'node:crypto';
import type { DistributedEventLog } from '../comms/a2a/EamilosDistributedEventLog.js';
import type { MissionEngine } from '../mission/MissionEngine.js';
import type { Mission, MissionStatus, MissionSnapshot } from '../mission/types.js';
import { InMemoryMissionControlStore, type MissionControlRecord, type MissionControlStore, SqliteMissionControlStore } from './MissionControlStore.js';

export interface MissionControlOptions {
  store?:MissionControlStore;
  storeFilename?:string;
  eventLog?:DistributedEventLog;
  maxActiveMissions?:number;
}
export interface MissionControlSummary extends MissionControlRecord {
  readyTaskCount:number;
  runningTaskCount:number;
  failedTaskCount:number;
}
const ACTIVE:new Set<MissionStatus>=new Set(['active','paused','blocked']);
const RUNNING=new Set(['CLAIMED','RUNNING','CHECKPOINTED','VALIDATING']);

export class MissionControl {
  readonly store:MissionControlStore;
  private readonly engine:MissionEngine;
  private readonly eventLog?:DistributedEventLog;
  private readonly maxActiveMissions?:number;
  private readonly ownedStore:boolean;

  constructor(engine:MissionEngine,options:MissionControlOptions={}) {
    if(options.store&&options.storeFilename)throw new Error('Provide either store or storeFilename, not both');
    this.engine=engine;this.eventLog=options.eventLog;this.maxActiveMissions=options.maxActiveMissions;
    this.ownedStore=!options.store;
    this.store=options.store??(options.storeFilename?new SqliteMissionControlStore({filename:options.storeFilename}):new InMemoryMissionControlStore());
    this.reconcile();
  }

  create(input:Parameters<MissionEngine['createMission']>[0]):Mission {
    const mission=this.engine.createMission(input);
    this.store.create(this.recordFromSnapshot(this.engine.snapshot(mission.id)));
    this.emit('mission.control.created',mission.id,{status:mission.status});
    return mission;
  }
  register(missionId:string):MissionControlRecord {
    const snapshot=this.engine.snapshot(missionId);
    const existing=this.store.get(missionId);
    if(existing){this.store.update(missionId,this.recordFromSnapshot(snapshot),existing.revision);return this.store.get(missionId)!;}
    return this.store.create(this.recordFromSnapshot(snapshot));
  }
  get(missionId:string):MissionControlSummary|undefined {const record=this.store.get(missionId);return record?this.summary(record,this.engine.snapshot(missionId)):undefined;}
  list(query?:Parameters<MissionControlStore['list']>[0]):MissionControlSummary[] {
    return this.store.list(query).map(record=>this.summary(record,this.engine.snapshot(record.missionId)));
  }
  start(missionId:string){return this.transition(missionId,'active',()=>this.engine.start(missionId));}
  pause(missionId:string){return this.transition(missionId,'paused',()=>this.engine.pause(missionId));}
  resume(missionId:string){return this.transition(missionId,'active',()=>this.engine.resume(missionId));}
  cancel(missionId:string){return this.transition(missionId,'cancelled',()=>this.engine.cancel(missionId));}
  refresh(missionId:string):MissionControlSummary{this.register(missionId);return this.get(missionId)!;}
  reconcile():MissionControlRecord[]{const records=this.store.list();const out:MissionControlRecord[]=[];for(const record of records){try{const snapshot=this.engine.snapshot(record.missionId);const current=this.recordFromSnapshot(snapshot);out.push(this.store.update(record.missionId,current,record.revision));}catch{this.store.delete(record.missionId);}}return out;}
  close(){if(this.ownedStore)this.store.close?.();}
  private transition(missionId:string,status:MissionStatus,action:()=>Mission):Mission {this.assertRegistered(missionId);if(status==='active'&&this.maxActiveMissions!==undefined&&this.activeCount()>=this.maxActiveMissions&&this.store.get(missionId)?.status!=='active')throw new Error('MAX_ACTIVE_MISSIONS_REACHED');const mission=action();this.refresh(missionId);this.emit(`mission.control.${status}`,missionId,{status});return mission;}
  private activeCount(){return this.store.list({status:'active'}).length;}
  private assertRegistered(id:string){if(!this.store.get(id))this.register(id);}
  private recordFromSnapshot(snapshot:MissionSnapshot):MissionControlRecord {const now=snapshot.mission.updatedAt;return{missionId:snapshot.mission.id,projectId:snapshot.mission.projectId,goal:snapshot.mission.goal,workingDir:snapshot.mission.workingDir,status:snapshot.mission.status,createdAt:snapshot.mission.createdAt,updatedAt:now,completedAt:snapshot.mission.completedAt,revision:1,activeTaskCount:snapshot.tasks.filter(t=>RUNNING.has(t.state)).length,totalTaskCount:snapshot.tasks.length,metadata:snapshot.mission.metadata};}
  private summary(record:MissionControlRecord,snapshot:MissionSnapshot):MissionControlSummary{return{...record,readyTaskCount:snapshot.tasks.filter(t=>t.state==='READY').length,runningTaskCount:snapshot.tasks.filter(t=>RUNNING.has(t.state)).length,failedTaskCount:snapshot.tasks.filter(t=>['FAILED','RECOVERABLE'].includes(t.state)).length};}
  private emit(type:string,missionId:string,payload:Record<string,unknown>){if(!this.eventLog)return;const id=createHash('sha256').update(`${type}:${missionId}:${Date.now()}:${JSON.stringify(payload)}`).digest('hex');this.eventLog.append({eventId:id,eventType:type,missionId,occurredAt:new Date().toISOString(),payload});}
}
