import type {AppModel} from '../model.js';import type {LoopIteration,LoopStage} from '../loop-data.js';
export const selectLoop=(m:AppModel)=>m.loop;
export const selectCurrentIteration=(m:AppModel):LoopIteration|undefined=>m.loop.iterations.find(i=>i.number===m.loop.iteration)??m.loop.iterations[m.loop.iterations.length-1];
export const selectLoopStage=(m:AppModel,stage:LoopStage)=>m.loop.stages.find(s=>s.stage===stage);
export const selectLoopDecisions=(m:AppModel)=>m.decisions.records.filter(d=>m.loop.decisionIds.includes(d.id));
