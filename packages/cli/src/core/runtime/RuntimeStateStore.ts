import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import type { RuntimeSnapshot } from './types.js';

const SnapshotSchema=z.object({
 version:z.number().int().positive(),missionId:z.string().min(1),
 state:z.enum(['CREATED','STARTING','PLANNING','SCHEDULING','EXECUTING','VALIDATING','RECOVERING','REPLANNING','WAITING','PAUSED','ESCALATED','COMPLETED','FAILED','ABORTED','STOPPING']),
 health:z.enum(['HEALTHY','DEGRADED','RECOVERING','BLOCKED','UNAVAILABLE']),
 counters:z.object({executions:z.number().int().nonnegative(),retries:z.number().int().nonnegative(),replans:z.number().int().nonnegative(),jevDecisions:z.number().int().nonnegative(),layaPlans:z.number().int().nonnegative(),costUsd:z.number().nonnegative(),startedAt:z.string().datetime()}),
 activeExecutions:z.array(z.string()),lastEventId:z.string().optional(),lastCheckpointId:z.string().optional(),updatedAt:z.string().datetime()
});

export class RuntimeStateStore {
 constructor(private readonly root:string){}
 async save(snapshot:RuntimeSnapshot){const parsed=SnapshotSchema.parse(snapshot);const path=this.path(snapshot.missionId);const tmp=path+'.tmp-'+Date.now();await mkdir(dirname(path),{recursive:true});await writeFile(tmp,JSON.stringify(parsed,null,2),'utf8');await rename(tmp,path);}
 async load(missionId:string):Promise<RuntimeSnapshot|undefined>{try{return SnapshotSchema.parse(JSON.parse(await readFile(this.path(missionId),'utf8'))) as RuntimeSnapshot;}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw error;}}
 private path(missionId:string){return this.root+'/'+encodeURIComponent(missionId)+'.json';}
}
