import { RuntimeController } from './RuntimeController.js';
import { RuntimeEventLog } from './RuntimeEventLog.js';
import { RuntimeStateStore } from './RuntimeStateStore.js';
import type { RuntimeDriver, RuntimePolicy, RuntimeStatus } from './types.js';

export class AutonomousRuntime {
 private readonly controllers=new Map<string,RuntimeController>();
 constructor(private readonly root:string,private readonly driverFactory:(missionId:string)=>RuntimeDriver,private readonly policy:RuntimePolicy){}
 private controller(missionId:string){
  let controller=this.controllers.get(missionId);
  if(!controller){controller=new RuntimeController(this.driverFactory(missionId),new RuntimeStateStore(this.root+'/state'),new RuntimeEventLog(this.root+'/events.jsonl'),this.policy);this.controllers.set(missionId,controller);}
  return controller;
 }
 start(missionId:string){return this.controller(missionId).start(missionId);}
 resume(missionId:string){return this.controller(missionId).resume(missionId);}
 pause(missionId:string){return this.controller(missionId).pause(missionId);}
 stop(missionId:string){return this.controller(missionId).stop(missionId);}
 recover(missionId:string){return this.controller(missionId).recover(missionId);}
 status(missionId:string):RuntimeStatus{return this.controller(missionId).status();}
 replay(missionId:string){return new RuntimeEventLog(this.root+'/events.jsonl').replay(missionId);}
}
