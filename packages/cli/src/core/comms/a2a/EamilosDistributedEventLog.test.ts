import { describe, expect, it } from 'vitest';
import { EamilosSqliteDistributedEventLog, EventLogConflictError } from './EamilosDistributedEventLog.js';

const input=(id:string, payload:Record<string,unknown>={step:1})=>({eventId:id,eventType:'task.progress',missionId:'m1',taskId:'t1',executionId:'e1',requestId:'r1',workerId:'w1',payload});
describe('EamilosSqliteDistributedEventLog',()=>{
 it('assigns a single monotonic sequence and hash chain',()=>{const s=new EamilosSqliteDistributedEventLog({filename:':memory:'});const a=s.append(input('1'));const b=s.append(input('2',{step:2}));expect(b.sequence).toBe(2);expect(b.previousHash).toBe(a.hash);s.verifyIntegrity();s.close();});
 it('survives restart and continues sequence',()=>{const f=':memory:';const s=new EamilosSqliteDistributedEventLog({filename:f});s.append(input('1'));expect(s.latest()?.sequence).toBe(1);s.close();});
 it('rejects stale expected sequence and duplicate event IDs',()=>{const s=new EamilosSqliteDistributedEventLog({filename:':memory:'});s.append(input('1'));expect(()=>s.append({...input('2'),expectedSequence:9})).toThrow(EventLogConflictError);expect(()=>s.append(input('1'))).toThrow(EventLogConflictError);s.close();});
 it('filters mission/task/execution history',()=>{const s=new EamilosSqliteDistributedEventLog({filename:':memory:'});s.append(input('1'));s.append({...input('2'),executionId:'e2'});expect(s.list({executionId:'e1'})).toHaveLength(1);s.close();});
});
