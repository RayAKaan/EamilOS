import type { ResourceRef } from './mission-data.js';

export type GraphNodeType='mission'|'task'|'execution'|'agent'|'device'|'artifact'|'session'|'file'|'commit'|'pull-request'|'loop'|'iteration'|'decision'|'plan'|'approval'|'evidence';
export type GraphEdgeType='contains'|'depends-on'|'executed-by'|'runs-on'|'produced'|'belongs-to'|'modified'|'committed-in'|'included-in'|'assigned-to'|'reassigned-to'|'validated-by';

export interface GraphNode {id:string; type:GraphNodeType; label:string; status?:string; resource:ResourceRef;}
export interface GraphEdge {id:string; from:string; to:string; type:GraphEdgeType;}
export interface GraphFocus {nodeId?:string; expanded:string[]; path?:string[];}
export interface GraphState {nodes:GraphNode[]; edges:GraphEdge[]; focus:GraphFocus; version:number; changedAt?:number;}
export function initialGraphState():GraphState{return{nodes:[],edges:[],focus:{expanded:[]},version:0};}
