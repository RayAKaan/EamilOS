export type LoopStage='observe'|'interpret'|'plan'|'execute'|'measure'|'validate'|'adapt';
export type LoopStatus='idle'|'running'|'paused'|'blocked'|'completed'|'failed';
export type LoopStageStatus='pending'|'active'|'completed'|'blocked'|'skipped';
export interface LoopStageState{stage:LoopStage;status:LoopStageStatus;startedAt?:number;completedAt?:number;decisionId?:string;}
export interface LoopIteration{id:string;number:number;objective:string;status:'running'|'completed'|'failed'|'blocked';currentStage:LoopStage;startedAt:number;completedAt?:number;decisionIds:string[];executionIds:string[];planId?:string;}
export interface LoopState{id?:string;missionId?:string;status:LoopStatus;iteration:number;currentStage:LoopStage;objective:string;progress?:number;startedAt?:number;updatedAt?:number;stages:LoopStageState[];iterations:LoopIteration[];decisionIds:string[];executionIds:string[];adaptationRequired:boolean;}
export const LOOP_STAGES:LoopStage[]=['observe','interpret','plan','execute','measure','validate','adapt'];
export function initialLoopState():LoopState{return{status:'idle',iteration:0,currentStage:'observe',objective:'',stages:LOOP_STAGES.map(stage=>({stage,status:'pending'})),iterations:[],decisionIds:[],executionIds:[],adaptationRequired:false};}
