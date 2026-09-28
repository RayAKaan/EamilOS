import type {ResourceRef} from './mission-data.js';
export type DecisionAction='ASSIGN'|'REASSIGN'|'RETRY'|'REPLAN'|'PAUSE'|'RESUME'|'STOP'|'CONTINUE'|'REQUEST_APPROVAL'|'ABORT'|'ADAPT';
export type DecisionProvider='jev'|'laya'|'runtime'|'human';
export type DecisionStatus='proposed'|'approved'|'denied'|'applied'|'rejected'|'superseded';
export interface DecisionAlternative{action:string;reason?:string;selected?:boolean;}
export interface DecisionRecord{id:string;missionId:string;loopId?:string;iterationId?:string;provider:DecisionProvider;action:DecisionAction;reason:string;targetResource?:ResourceRef;sourceResources:ResourceRef[];evidenceIds:string[];graphVersion?:number;alternatives?:DecisionAlternative[];status:DecisionStatus;createdAt:number;resolvedAt?:number;outcome?:string;}
export interface PlanStep{id:string;title:string;status:'pending'|'active'|'completed'|'failed';}
export interface PlanRecord{id:string;missionId:string;loopId?:string;iterationId?:string;provider:'laya'|'runtime';objective:string;steps:PlanStep[];status:'proposed'|'active'|'completed'|'superseded'|'failed';createdAt:number;}
export interface DecisionState{records:DecisionRecord[];plans:PlanRecord[];selectedDecisionId?:string;}
export function initialDecisionState():DecisionState{return{records:[],plans:[]};}
