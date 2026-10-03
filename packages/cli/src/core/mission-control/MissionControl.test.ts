import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MissionEngine } from '../mission/MissionEngine.js';
import { MissionStore } from '../mission/MissionStore.js';
import { MissionControlPlane } from './MissionControlPlane.js';
import { InMemoryMissionControlPlaneStore, MissionControlPlaneConflictError, SqliteMissionControlPlaneStore } from './MissionControlPlaneStore.js';

function engine(){return new MissionEngine(new MissionStore(mkdtempSync(join(tmpdir(),'eamilos-mission-'))));}
describe('MissionControlPlane',()=>{
 it('controls multiple missions independently and exposes summaries',()=>{
   const e=engine();const c=new MissionControlPlane(e);
   const a=c.create({goal:'A',workingDir:'/tmp/a'});const b=c.create({goal:'B',workingDir:'/tmp/b'});
   expect(c.list()).toHaveLength(2);c.start(a.id);expect(c.get(a.id)?.status).toBe('active');expect(c.get(b.id)?.status).toBe('created');
   e.addTask(a.id,{title:'task',description:'task'});expect(c.get(a.id)?.totalTaskCount).toBe(1);expect(c.get(a.id)?.readyTaskCount).toBe(1);
   c.pause(a.id);expect(c.get(a.id)?.status).toBe('paused');c.start(b.id);expect(c.list({status:'active'}).map(x=>x.missionId)).toEqual([b.id]);
 });
 it('enforces maximum active missions',()=>{
   const e=engine();const c=new MissionControlPlane(e,{maxActiveMissions:1});const a=c.create({goal:'A',workingDir:'/tmp/a'});const b=c.create({goal:'B',workingDir:'/tmp/b'});c.start(a.id);expect(()=>c.start(b.id)).toThrow('MAX_ACTIVE_MISSIONS_REACHED');
 });
 it('persists and recovers the control index',()=>{
   const e=engine();const a=e.createMission({goal:'A',workingDir:'/tmp/a'});const d=mkdtempSync(join(tmpdir(),'eamilos-control-'));const f=join(d,'control.sqlite');
   try{const c=new MissionControlPlane(e,{storeFilename:f});c.register(a.id);c.start(a.id);c.close();const recovered=new MissionControlPlane(e,{storeFilename:f});expect(recovered.get(a.id)?.status).toBe('active');expect(recovered.get(a.id)?.missionId).toBe(a.id);recovered.close();}finally{rmSync(d,{recursive:true,force:true});}
 });
});
describe('MissionControlPlaneStore',()=>{
 it('rejects stale optimistic updates',()=>{const s=new InMemoryMissionControlPlaneStore();const now=new Date().toISOString();s.create({missionId:'m',goal:'g',workingDir:'/tmp',status:'created',createdAt:now,updatedAt:now,revision:1,activeTaskCount:0,totalTaskCount:0,metadata:{}});expect(()=>s.update('m',{status:'active'},2)).toThrow(MissionControlPlaneConflictError);});
 it('recovers sqlite records after restart',()=>{
   const d=mkdtempSync(join(tmpdir(),'eamilos-store-'));const f=join(d,'store.sqlite');
   try{const s=new SqliteMissionControlPlaneStore({filename:f});const now=new Date().toISOString();s.create({missionId:'m',goal:'g',workingDir:'/tmp',status:'created',createdAt:now,updatedAt:now,revision:1,activeTaskCount:0,totalTaskCount:0,metadata:{x:1}});s.close();const r=new SqliteMissionControlPlaneStore({filename:f});expect(r.get('m')?.metadata).toEqual({x:1});r.close();}finally{rmSync(d,{recursive:true,force:true});}
 });
});
