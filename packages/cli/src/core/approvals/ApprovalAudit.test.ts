import { describe, expect, it } from 'vitest';
import { EamilosSqliteDistributedEventLog } from '../comms/a2a/EamilosDistributedEventLog.js';
import { ApprovalAuditRecorder } from './ApprovalAudit.js';
import type { ApprovalRecord } from './ApprovalTypes.js';

function approval(status: ApprovalRecord['status'] = 'pending', revision = 1): ApprovalRecord {
  return {
    approvalId: 'approval_e1', missionId: 'm1', taskId: 't1', executionId: 'e1', requestId: 'r1', policyId: 'policy.safe', scope: 'execution', requestedBy: 'agent-1', reason: 'protected command',
    evidence: [{ kind: 'command', name: 'command', value: 'rm -rf /', sensitive: true }, { kind: 'working_directory', name: 'cwd', value: '/workspace' }],
    createdAt: '2026-10-03T10:00:00.000Z', status, revision,
    ...(status === 'approved' || status === 'rejected' ? { decisionBy: 'human-1', decisionAt: '2026-10-03T10:01:00.000Z' } : {}),
    ...(status === 'consumed' ? { consumedAt: '2026-10-03T10:02:00.000Z' } : {}),
  };
}

describe('ApprovalAuditRecorder', () => {
  it('records a redacted request event with full correlation', () => {
    const log = new EamilosSqliteDistributedEventLog({ filename: ':memory:' });
    const event = new ApprovalAuditRecorder({ eventLog: log }).recordRequested(approval());
    expect(event.eventType).toBe('approval.requested');
    expect(event.missionId).toBe('m1'); expect(event.taskId).toBe('t1'); expect(event.executionId).toBe('e1'); expect(event.requestId).toBe('r1');
    expect(event.payload).toMatchObject({ approvalId: 'approval_e1', policyId: 'policy.safe', revision: 1 });
    expect(JSON.stringify(event)).not.toContain('rm -rf /');
    log.verifyIntegrity(); log.close();
  });

  it('maps transitions to deterministic event ids', () => {
    const log = new EamilosSqliteDistributedEventLog({ filename: ':memory:' }); const recorder = new ApprovalAuditRecorder({ eventLog: log });
    recorder.recordRequested(approval()); recorder.recordTransition(approval(), approval('approved', 2));
    const events = log.list();
    expect(events.map((event) => event.eventType)).toEqual(['approval.requested', 'approval.approved']);
    expect(events[1]?.eventId).toBe('approval:approval_e1:2:approval.approved'); log.close();
  });

  it('rejects correlation and revision drift', () => {
    const log = new EamilosSqliteDistributedEventLog({ filename: ':memory:' }); const recorder = new ApprovalAuditRecorder({ eventLog: log });
    expect(() => recorder.recordTransition(approval(), { ...approval('approved', 2), taskId: 'other-task' })).toThrow('APPROVAL_AUDIT_CORRELATION_MISMATCH');
    expect(() => recorder.recordTransition(approval(), approval('approved', 4))).toThrow('APPROVAL_AUDIT_REVISION_MISMATCH'); log.close();
  });

  it('rejects duplicate lifecycle events through the event log', () => {
    const log = new EamilosSqliteDistributedEventLog({ filename: ':memory:' }); const recorder = new ApprovalAuditRecorder({ eventLog: log });
    recorder.recordRequested(approval()); expect(() => recorder.recordRequested(approval())).toThrow('EVENT_ID_ALREADY_EXISTS'); log.close();
  });

  it('preserves a tamper-evident execution audit history', () => {
    const log = new EamilosSqliteDistributedEventLog({ filename: ':memory:' }); const recorder = new ApprovalAuditRecorder({ eventLog: log });
    recorder.recordRequested(approval()); recorder.recordTransition(approval(), approval('approved', 2));
    expect(() => log.verifyIntegrity()).not.toThrow(); expect(log.list({ executionId: 'e1' })).toHaveLength(2); log.close();
  });
});