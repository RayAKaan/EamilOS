import Database from 'better-sqlite3';
import type { ScheduleDecision, SchedulerSnapshot, SchedulerStore } from './GlobalSchedulerTypes.js';

function clone(d: ScheduleDecision): ScheduleDecision { return { ...d }; }

export class InMemorySchedulerStore implements SchedulerStore {
  private revision = 0;
  private decisions = new Map<string, ScheduleDecision>();
  nextRevision(): number { this.revision += 1; return this.revision; }
  snapshot(): SchedulerSnapshot {
    const decisions = [...this.decisions.values()].sort((a,b)=>a.decisionId.localeCompare(b.decisionId)).map(clone);
    return { revision: this.revision, activeDecisionCount: decisions.filter(d=>['scheduled','dispatched'].includes(d.state)).length, decisions };
  }
  saveDecision(d: ScheduleDecision): void { if (this.decisions.has(d.decisionId)) throw new Error('SCHEDULER_DECISION_EXISTS'); this.decisions.set(d.decisionId, clone(d)); }
  updateDecision(id: string, patch: Partial<ScheduleDecision>): ScheduleDecision {
    const old=this.decisions.get(id); if(!old) throw new Error('SCHEDULER_DECISION_NOT_FOUND');
    const next=clone({...old,...patch,updatedAt:new Date().toISOString()}); this.decisions.set(id,next); return clone(next);
  }
  getDecision(id:string){const d=this.decisions.get(id);return d?clone(d):undefined;}
  getByIdempotencyKey(key:string){return [...this.decisions.values()].find(d=>d.idempotencyKey===key);}
  listActive(){return [...this.decisions.values()].filter(d=>['scheduled','dispatched'].includes(d.state)).map(clone);}
}

type Row={decision_id:string;idempotency_key:string;scheduler_revision:number;mission_id:string;task_id:string;execution_id:string;worker_id:string;agent_id:string;harness_id:string;priority:string;fencing_token:number;lease_id:string;state:string;created_at:string;updated_at:string;reason:string|null};
function hydrate(r:Row):ScheduleDecision{return{decisionId:r.decision_id,idempotencyKey:r.idempotency_key,schedulerRevision:r.scheduler_revision,missionId:r.mission_id,taskId:r.task_id,executionId:r.execution_id,workerId:r.worker_id,agentId:r.agent_id,harnessId:r.harness_id,priority:r.priority as ScheduleDecision['priority'],fencingToken:r.fencing_token,leaseId:r.lease_id,state:r.state as ScheduleDecision['state'],createdAt:r.created_at,updatedAt:r.updated_at,reason:r.reason??undefined};}

export class SqliteSchedulerStore implements SchedulerStore {
  private db:Database.Database;
  constructor(options:{filename:string;busyTimeoutMs?:number}){this.db=new Database(options.filename);this.db.pragma(`busy_timeout = ${Math.max(0,Math.floor(options.busyTimeoutMs??5000))}`);this.db.pragma('foreign_keys = ON');if(options.filename!==':memory:')this.db.pragma('journal_mode = WAL');this.db.exec(`CREATE TABLE IF NOT EXISTS eamilos_scheduler_state(id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL,updated_at TEXT);INSERT OR IGNORE INTO eamilos_scheduler_state(id,revision) VALUES(1,0);CREATE TABLE IF NOT EXISTS eamilos_scheduler_decisions(decision_id TEXT PRIMARY KEY,idempotency_key TEXT UNIQUE NOT NULL,scheduler_revision INTEGER NOT NULL,mission_id TEXT NOT NULL,task_id TEXT NOT NULL,execution_id TEXT UNIQUE NOT NULL,worker_id TEXT NOT NULL,agent_id TEXT NOT NULL,harness_id TEXT NOT NULL,priority TEXT NOT NULL,fencing_token INTEGER NOT NULL,lease_id TEXT NOT NULL,state TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,reason TEXT)`);}
  nextRevision(){this.db.prepare('UPDATE eamilos_scheduler_state SET revision=revision+1,updated_at=? WHERE id=1').run(new Date().toISOString());return (this.db.prepare('SELECT revision FROM eamilos_scheduler_state WHERE id=1').get() as {revision:number}).revision;}
  snapshot(){const decisions=(this.db.prepare('SELECT * FROM eamilos_scheduler_decisions ORDER BY decision_id').all() as Row[]).map(hydrate);return{revision:(this.db.prepare('SELECT revision FROM eamilos_scheduler_state WHERE id=1').get() as {revision:number}).revision,updatedAt:new Date().toISOString(),activeDecisionCount:decisions.filter(d=>['scheduled','dispatched'].includes(d.state)).length,decisions};}
  saveDecision(d:ScheduleDecision){this.db.prepare('INSERT INTO eamilos_scheduler_decisions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(d.decisionId,d.idempotencyKey,d.schedulerRevision,d.missionId,d.taskId,d.executionId,d.workerId,d.agentId,d.harnessId,d.priority,d.fencingToken,d.leaseId,d.state,d.createdAt,d.updatedAt,d.reason??null);}
  updateDecision(id:string,patch:Partial<ScheduleDecision>){const old=this.getDecision(id);if(!old)throw new Error('SCHEDULER_DECISION_NOT_FOUND');const next=clone({...old,...patch,updatedAt:new Date().toISOString()});this.db.prepare('UPDATE eamilos_scheduler_decisions SET state=?,updated_at=?,reason=? WHERE decision_id=?').run(next.state,next.updatedAt,next.reason??null,id);return next;}
  getDecision(id:string){const r=this.db.prepare('SELECT * FROM eamilos_scheduler_decisions WHERE decision_id=?').get(id) as Row|undefined;return r?hydrate(r):undefined;}
  getByIdempotencyKey(key:string){const r=this.db.prepare('SELECT * FROM eamilos_scheduler_decisions WHERE idempotency_key=?').get(key) as Row|undefined;return r?hydrate(r):undefined;}
  listActive(){return(this.db.prepare("SELECT * FROM eamilos_scheduler_decisions WHERE state IN ('scheduled','dispatched') ORDER BY decision_id").all() as Row[]).map(hydrate);}
  close(){if(this.db.open)this.db.close();}
}
