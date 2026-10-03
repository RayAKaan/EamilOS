import { describe, expect, it } from 'vitest';
import { ApprovalAuditRecorder } from './ApprovalAudit.js';
import { ApprovalController } from './ApprovalController.js';
import { InMemoryApprovalStore } from './ApprovalStore.js';
import { EamilosSqliteDistributedEventLog } from '../comms/a2a/EamilosDistributedEventLog.js';
import type { ApprovalRequest } from './ApprovalTypes.js';

const request: ApprovalRequest = { approvalId:'approval_e1', missionId:'m1', taskId:'t1', executionId:'e1', requestId:'r1', policyId:'p1', scope:'execution', requestedBy:'agent-1', reason:'protected action', evidence:[{kind:'command',name:'command',value:'secret-command',sensitive:true}], createdAt:'2026-10-03T10:00:00.000Z' };

describe('ApprovalController audit integration',()=>{
 it('records human approvals and rejections as correlated audit events',()=>{
   const store=new InMemoryApprovalStore(); const log=new EamilosSqliteDistributedEventLog({filename:':memory:'}); const audit=new ApprovalAuditRecorder({eventLog:log});
   store.create(request); const controller=new ApprovalController({store,audit,now:()=> '2026-10-03T10:01:00.000Z'});
   const result=controller.approve('approval_e1','human-1','approved for this run');
   expect(result.approval.status).toBe('approved');
   expect(log.list({executionId:'e1'}).map(e=>e.eventType)).toEqual(['approval.approved']);
   expect(log.latest()?.payload).toMatchObject({approvalId:'approval_e1',revision:2,decisionBy:'human-1'});
   log.verifyIntegrity(); log.close();
 });
 it('does not emit an audit event for a stale decision',()=>{
   const store=new InMemoryApprovalStore(); const log=new EamilosSqliteDistributedEventLog({filename:':memory:'}); const audit=new ApprovalAuditRecorder({eventLog:log});
   store.create(request); const controller=new ApprovalController({store,audit});
   expect(()=>controller.reject('approval_e1','human-2',undefined,99)).toThrow('STALE_APPROVAL_REVISION');
   expect(log.list()).toHaveLength(0); log.close();
 });
});