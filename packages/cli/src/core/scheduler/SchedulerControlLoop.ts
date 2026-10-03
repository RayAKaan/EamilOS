import type { GlobalScheduler } from './GlobalScheduler.js';
import type { ScheduleDecision } from './GlobalSchedulerTypes.js';

export interface SchedulerControlLoopOptions {
  scheduler: GlobalScheduler;
  intervalMs?: number;
  maxDispatchPerTick?: number;
}

export interface SchedulerControlLoopTick {
  rescheduled: ScheduleDecision[];
  scheduled: ScheduleDecision[];
  dispatched: ScheduleDecision[];
  failedDispatches: Array<{ decisionId: string; error: string }>;
}

export class SchedulerControlLoop {
  private readonly scheduler: GlobalScheduler;
  private readonly intervalMs: number;
  private readonly maxDispatchPerTick: number;
  private timer: ReturnType<typeof setInterval> | undefined;
  private ticking = false;

  constructor(options: SchedulerControlLoopOptions) {
    this.scheduler=options.scheduler;
    this.intervalMs=Math.max(100,Math.floor(options.intervalMs??1000));
    this.maxDispatchPerTick=Math.max(1,Math.floor(options.maxDispatchPerTick??32));
  }

  async tick(): Promise<SchedulerControlLoopTick> {
    if(this.ticking) return {rescheduled:[],scheduled:[],dispatched:[],failedDispatches:[]};
    this.ticking=true;
    try {
      const rescheduled=this.scheduler.reconcile();
      const scheduled=this.scheduler.cycle();
      const dispatched:ScheduleDecision[]=[];
      const failedDispatches:Array<{decisionId:string;error:string}>=[];
      for(const decision of scheduled.slice(0,this.maxDispatchPerTick)){
        try{dispatched.push(await this.scheduler.dispatch(decision.decisionId));}
        catch(error){failedDispatches.push({decisionId:decision.decisionId,error:String(error)});}
      }
      return {rescheduled,scheduled,dispatched,failedDispatches};
    } finally { this.ticking=false; }
  }

  start(): void {
    if(this.timer)return;
    this.timer=setInterval(()=>{void this.tick();},this.intervalMs);
  }

  stop(): void {
    if(this.timer){clearInterval(this.timer);this.timer=undefined;}
  }

  get running(): boolean { return this.timer!==undefined; }
}
