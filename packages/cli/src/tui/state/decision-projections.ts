import type {AppModel} from '../model.js';import type {DecisionRecord,PlanRecord} from '../decision-data.js';
export const selectDecisions=(m:AppModel):DecisionRecord[]=>m.decisions.records;
export const selectCurrentDecision=(m:AppModel):DecisionRecord|undefined=>m.decisions.records.find(d=>d.id===m.decisions.selectedDecisionId)??m.decisions.records[m.decisions.records.length-1];
export const selectPlans=(m:AppModel):PlanRecord[]=>m.decisions.plans;
