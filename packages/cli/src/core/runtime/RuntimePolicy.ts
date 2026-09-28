import type { RuntimeCounters, RuntimePolicy } from './types.js';

export class RuntimePolicyGuard {
 constructor(private readonly policy:RuntimePolicy){}
 check(counters:RuntimeCounters){
  const b=this.policy.budget;
  if(b.maxWallTimeMs!==undefined && Date.now()-Date.parse(counters.startedAt)>=b.maxWallTimeMs)return {allowed:false,reason:'Runtime wall-time budget exhausted'};
  if(b.maxExecutions!==undefined && counters.executions>=b.maxExecutions)return {allowed:false,reason:'Execution budget exhausted'};
  if(b.maxRetries!==undefined && counters.retries>=b.maxRetries)return {allowed:false,reason:'Retry budget exhausted'};
  if(b.maxReplans!==undefined && counters.replans>=b.maxReplans)return {allowed:false,reason:'Replan budget exhausted'};
  if(b.maxJevDecisions!==undefined && counters.jevDecisions>=b.maxJevDecisions)return {allowed:false,reason:'Jev decision budget exhausted'};
  if(b.maxLayaPlans!==undefined && counters.layaPlans>=b.maxLayaPlans)return {allowed:false,reason:'Laya planning budget exhausted'};
  if(b.maxCostUsd!==undefined && counters.costUsd>=b.maxCostUsd)return {allowed:false,reason:'Cost budget exhausted'};
  return {allowed:true};
 }
}
