import {describe,expect,it} from 'vitest';
import {initialModel} from '../model.js';
import {update} from '../update.js';
import {buildMissionGraph} from '../graph-builder.js';
import {renderLoop,renderDecisions,renderApprovals} from './loopDecisionApproval.js';
import type {Layout} from '../layout.js';

const layout={mainWidth:100,viewportHeight:24} as Layout;
describe('Phase 13.5 Loop Decision Approval projections',()=>{
 it('projects loop stages and iterations in order',()=>{
  let m=initialModel(120,40);
  m=update(m,{type:'SESSION_STARTED'});
  expect(m.loop.status).toBe('running');
  expect(m.loop.iteration).toBe(1);
  m=update(m,{type:'LOOP_STAGE',stage:'observe',status:'completed'});
  m=update(m,{type:'LOOP_STAGE',stage:'interpret',status:'completed'});
  m=update(m,{type:'LOOP_STAGE',stage:'plan',status:'active'});
  expect(m.loop.currentStage).toBe('plan');
  expect(m.loop.stages.find(s=>s.stage==='plan')?.status).toBe('active');
  expect(renderLoop(m,layout)).toHaveLength(24);
 });
 it('records decision provenance and resolution',()=>{
  let m=initialModel(120,40);
  m=update(m,{type:'SESSION_STARTED'});
  m=update(m,{type:'DECISION_PROPOSED',decision:{id:'42',missionId:m.missionUi.id,loopId:m.loop.id,iterationId:m.loop.iterations[0]?.id,provider:'jev',action:'REASSIGN',reason:'Worker unavailable',sourceResources:[{type:'task',id:'task-1'},{type:'device',id:'device-b'}],evidenceIds:['e1'],status:'proposed',createdAt:Date.now()}});
  m=update(m,{type:'DECISION_RESOLVED',decisionId:'42',status:'applied',outcome:'Moved to Device A'});
  expect(m.decisions.records[0]?.status).toBe('applied');
  expect(m.loop.decisionIds).toContain('42');
  expect(renderDecisions(m,layout)).toHaveLength(24);
 });
 it('keeps approval scope explicit',()=>{
  let m=initialModel(120,40);
  m=update(m,{type:'SESSION_STARTED'});
  m=update(m,{type:'APPROVAL_REQUESTED',approval:{id:'ap-1',missionId:m.missionUi.id,action:'Deploy',reason:'Production change',risk:'high',policy:'Production requires approval',affectedResources:[{type:'task',id:'task-1'}],affectedFiles:['deploy.yml'],affectedDevices:['device-a'],requestedBy:'runtime',createdAt:Date.now(),status:'pending'}});
  expect(m.missionUi.pendingApprovals).toBe(1);
  m=update(m,{type:'APPROVAL_RESOLVED',approvalId:'ap-1',resolution:'approve-once'});
  expect(m.approvals.requests[0]?.resolution).toBe('approve-once');
  expect(m.approvals.requests[0]?.status).toBe('approved');
  expect(renderApprovals(m,layout)).toHaveLength(24);
 });
 it('adds autonomy resources to the cognitive graph',()=>{
  let m=initialModel(120,40);
  m=update(m,{type:'SESSION_STARTED'});
  m=update(m,{type:'DECISION_PROPOSED',decision:{id:'d1',missionId:m.missionUi.id,loopId:m.loop.id,iterationId:m.loop.iterations[0]?.id,provider:'runtime',action:'RETRY',reason:'Retry validation',sourceResources:[],evidenceIds:['e1'],status:'proposed',createdAt:Date.now()}});
  m=update(m,{type:'APPROVAL_REQUESTED',approval:{id:'a1',missionId:m.missionUi.id,decisionId:'d1',action:'Deploy',reason:'Needs authorization',risk:'medium',affectedResources:[],affectedFiles:[],affectedDevices:[],requestedBy:'runtime',createdAt:Date.now(),status:'pending'}});
  m={...m,graph:{...buildMissionGraph(m),focus:m.graph.focus,version:m.graph.version+1}};
  expect(m.graph.nodes.some(n=>n.type==='loop')).toBe(true);
  expect(m.graph.nodes.some(n=>n.type==='decision')).toBe(true);
  expect(m.graph.nodes.some(n=>n.type==='approval')).toBe(true);
  expect(m.graph.edges.some(e=>e.type==='requires')).toBe(true);
 });
});
