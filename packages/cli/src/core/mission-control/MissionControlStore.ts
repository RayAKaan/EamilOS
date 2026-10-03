import Database from 'better-sqlite3';
import type { MissionStatus } from '../mission/types.js';

export interface MissionControlRecord {
  missionId:string;
  projectId?:string;
  goal:string;
  workingDir:string;
  status:MissionStatus;
  createdAt:string;
  updatedAt:string;
  completedAt?:string;
  revision:number;
  activeTaskCount:number;
  totalTaskCount:number;
  metadata:Record<string,unknown>;
}

export interface MissionControlQuery {
  status?:MissionStatus|MissionStatus[];
  projectId?:string;
  limit?:number;
}

export interface MissionControlStore {
  create(record:MissionControlRecord):MissionControlRecord;
  get(missionId:string):MissionControlRecord|undefined;
  list(query?:MissionControlQuery):MissionControlRecord[];
  update(missionId:string, patch:Partial<MissionControlRecord>, expectedRevision?:number):MissionControlRecord;
  delete(missionId:string):void;
  close?():void;
}

export class MissionControlConflictError extends Error {
  readonly code='MISSION_CONTROL_CONFLICT' as const;
  constructor(message:string){super(message);this.name='MissionControlConflictError';}
}

function clone(r:MissionControlRecord):MissionControlRecord{return {...r,metadata:{...r.metadata}};}

export class InMemoryMissionControlStore implements MissionControlStore {
  private records=new Map<string,MissionControlRecord>();
  create(record:MissionControlRecord){if(this.records.has(record.missionId))throw new MissionControlConflictError('MISSION_ALREADY_REGISTERED');this.records.set(record.missionId,clone(record));return clone(record);}
  get(id:string){const r=this.records.get(id);return r?clone(r):undefined;}
  list(q:MissionControlQuery={}){const statuses=q.status?(Array.isArray(q.status)?q.status:[q.status]):undefined;const out=[...this.records.values()].filter(r=>(!statuses||statuses.includes(r.status))&&(!q.projectId||r.projectId===q.projectId)).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.missionId.localeCompare(b.missionId));return q.limit===undefined?out.slice():out.slice(0,Math.max(0,q.limit));}
  update(id:string,patch:Partial<MissionControlRecord>,expectedRevision?:number){const old=this.records.get(id);if(!old)throw new MissionControlConflictError('MISSION_NOT_REGISTERED');if(expectedRevision!==undefined&&old.revision!==expectedRevision)throw new MissionControlConflictError(`STALE_MISSION_REVISION:${expectedRevision}:${old.revision}`);const next=clone({...old,...patch,missionId:old.missionId,revision:old.revision+1});this.records.set(id,next);return clone(next);}
  delete(id:string){this.records.delete(id);}
}

type Row={mission_id:string;project_id:string|null;goal:string;working_dir:string;status:MissionStatus;created_at:string;updated_at:string;completed_at:string|null;revision:number;active_task_count:number;total_task_count:number;metadata_json:string};
function hydrate(r:Row):MissionControlRecord{return{missionId:r.mission_id,projectId:r.project_id??undefined,goal:r.goal,workingDir:r.working_dir,status:r.status,createdAt:r.created_at,updatedAt:r.updated_at,completedAt:r.completed_at??undefined,revision:r.revision,activeTaskCount:r.active_task_count,totalTaskCount:r.total_task_count,metadata:JSON.parse(r.metadata_json) as Record<string,unknown>};}

export class SqliteMissionControlStore implements MissionControlStore {
  private db:Database.Database;
  constructor(options:{filename:string;busyTimeoutMs?:number}){this.db=new Database(options.filename);this.db.pragma(`busy_timeout = ${Math.max(0,Math.floor(options.busyTimeoutMs??5000))}`);this.db.pragma('foreign_keys = ON');if(options.filename!==':memory:')this.db.pragma('journal_mode = WAL');this.migrate();}
  create(record:MissionControlRecord){try{this.db.prepare(`INSERT INTO eamilos_mission_control(mission_id,project_id,goal,working_dir,status,created_at,updated_at,completed_at,revision,active_task_count,total_task_count,metadata_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(record.missionId,record.projectId??null,record.goal,record.workingDir,record.status,record.createdAt,record.updatedAt,record.completedAt??null,record.revision,record.activeTaskCount,record.totalTaskCount,JSON.stringify(record.metadata));return clone(record);}catch(e){if(String(e).includes('UNIQUE'))throw new MissionControlConflictError('MISSION_ALREADY_REGISTERED');throw e;}}
  get(id:string){const r=this.db.prepare('SELECT * FROM eamilos_mission_control WHERE mission_id=?').get(id) as Row|undefined;return r?hydrate(r):undefined;}
  list(q:MissionControlQuery={}){const clauses:string[]=[];const vals:unknown[]=[];if(q.status){const s=Array.isArray(q.status)?q.status:[q.status];clauses.push(`status IN (${s.map(()=>'?').join(',')})`);vals.push(...s);}if(q.projectId){clauses.push('project_id=?');vals.push(q.projectId);}const limit=Math.max(1,Math.min(10000,Math.floor(q.limit??10000)));vals.push(limit);return(this.db.prepare(`SELECT * FROM eamilos_mission_control${clauses.length?' WHERE '+clauses.join(' AND '):''} ORDER BY created_at ASC, mission_id ASC LIMIT ?`).all(...vals) as Row[]).map(hydrate);}
  update(id:string,patch:Partial<MissionControlRecord>,expectedRevision?:number){const old=this.get(id);if(!old)throw new MissionControlConflictError('MISSION_NOT_REGISTERED');if(expectedRevision!==undefined&&old.revision!==expectedRevision)throw new MissionControlConflictError(`STALE_MISSION_REVISION:${expectedRevision}:${old.revision}`);const next=clone({...old,...patch,missionId:id,revision:old.revision+1});this.db.prepare(`UPDATE eamilos_mission_control SET project_id=?,goal=?,working_dir=?,status=?,created_at=?,updated_at=?,completed_at=?,revision=?,active_task_count=?,total_task_count=?,metadata_json=? WHERE mission_id=? AND revision=?`).run(next.projectId??null,next.goal,next.workingDir,next.status,next.createdAt,next.updatedAt,next.completedAt??null,next.revision,next.activeTaskCount,next.totalTaskCount,JSON.stringify(next.metadata),id,old.revision);return next;}
  delete(id:string){this.db.prepare('DELETE FROM eamilos_mission_control WHERE mission_id=?').run(id);}
  close(){if(this.db.open)this.db.close();}
  private migrate(){this.db.exec(`CREATE TABLE IF NOT EXISTS eamilos_mission_control_schema_migrations(version INTEGER PRIMARY KEY NOT NULL,applied_at TEXT NOT NULL);CREATE TABLE IF NOT EXISTS eamilos_mission_control(mission_id TEXT PRIMARY KEY NOT NULL,project_id TEXT,goal TEXT NOT NULL,working_dir TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,completed_at TEXT,revision INTEGER NOT NULL,active_task_count INTEGER NOT NULL,total_task_count INTEGER NOT NULL,metadata_json TEXT NOT NULL);CREATE INDEX IF NOT EXISTS idx_eamilos_mission_control_status ON eamilos_mission_control(status);CREATE INDEX IF NOT EXISTS idx_eamilos_mission_control_project ON eamilos_mission_control(project_id);`);const row=this.db.prepare('SELECT MAX(version) version FROM eamilos_mission_control_schema_migrations').get() as {version?:number|null};if((row.version??0)<1)this.db.prepare('INSERT INTO eamilos_mission_control_schema_migrations VALUES(?,?)').run(1,new Date().toISOString());}
}
