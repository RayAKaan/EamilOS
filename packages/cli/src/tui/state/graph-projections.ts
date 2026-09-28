import type { AppModel } from '../model.js';
import type { GraphNode } from '../graph-data.js';

export const selectGraphNodes=(model:AppModel)=>model.graph.nodes;
export const selectGraphEdges=(model:AppModel)=>model.graph.edges;
export const selectFocusedGraphNode=(model:AppModel)=>model.graph.nodes.find(n=>n.id===model.graph.focus.nodeId);
export function selectGraphNeighbors(model:AppModel,nodeId:string):GraphNode[]{const ids=new Set<string>();for(const e of model.graph.edges){if(e.from===nodeId)ids.add(e.to);if(e.to===nodeId)ids.add(e.from);}return model.graph.nodes.filter(n=>ids.has(n.id));}
export function selectGraphSubgraph(model:AppModel,nodeId:string,depth=1):{nodes:GraphNode[];edges:typeof model.graph.edges}{let frontier=new Set([nodeId]);const seen=new Set(frontier);for(let i=0;i<depth;i++){const next=new Set<string>();for(const e of model.graph.edges){if(frontier.has(e.from)&&!seen.has(e.to))next.add(e.to);if(frontier.has(e.to)&&!seen.has(e.from))next.add(e.from);}for(const id of next)seen.add(id);frontier=next;}return{nodes:model.graph.nodes.filter(n=>seen.has(n.id)),edges:model.graph.edges.filter(e=>seen.has(e.from)&&seen.has(e.to))};}
export function selectGraphPath(model:AppModel,from:string,to:string):string[]{const q:string[][]=[[from]];const seen=new Set([from]);while(q.length){const path=q.shift()!;const cur=path[path.length-1]!;if(cur===to)return path;for(const e of model.graph.edges){const next=e.from===cur?e.to:e.to===cur?e.from:undefined;if(next&&!seen.has(next)){seen.add(next);q.push([...path,next]);}}}return[];}
