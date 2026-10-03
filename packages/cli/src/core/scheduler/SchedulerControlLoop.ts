import type { GlobalScheduler } from './GlobalScheduler.js';
import type { ScheduleDecision } from './GlobalSchedulerTypes.js';
import type { ApprovalExpiryService } from '../approvals/ApprovalExpiryService.js';
import type { ApprovalAuditReconciliationService } from '../approvals/ApprovalAuditReconciliationService.js';

export interface SchedulerControlLoopOptions {
  scheduler: GlobalScheduler;
  intervalMs?: number;
  maxDispatchPerTick?: number;
  approvalExpiry?: ApprovalExpiryService;
  approvalAuditReconciliation?: ApprovalAuditReconciliationService;
}

export interface SchedulerControlLoopTick {
  renewed: ScheduleDecision[];
  rescheduled: ScheduleDecision[];
  scheduled: ScheduleDecision[];
  dispatched: ScheduleDecision[];
  failedDispatches: Array<{ decisionId: string; error: string }>;
  expiredApprovals: string[];
  reconciledApprovals: string[];
}

export class SchedulerControlLoop {
  private readonly scheduler: GlobalScheduler;
  private readonly intervalMs: number;
  private readonly maxDispatchPerTick: number;
  private readonly approvalExpiry?: ApprovalExpiryService;
  private readonly approvalAuditReconciliation?: ApprovalAuditReconciliationService;
  private timer: ReturnType<typeof setInterval> | undefined;
  private ticking = false;

  constructor(options: SchedulerControlLoopOptions) {
    this.scheduler=options.scheduler;
    this.intervalMs=Math.max(100,Math.floor(options.intervalMs??1000));
    this.maxDispatchPerTick=Math.max(1,Math.floor(options.maxDispatchPerTick??32));
    this.approvalExpiry=options.approvalExpiry;
    this.approvalAuditReconciliation=options.approvalAuditReconciliation;
  }

  async tick(): Promise<SchedulerControlLoopTick> {
    if(this.ticking) return {renewed:[],rescheduled:[],scheduled:[],dispatched:[],failedDispatches:[],expiredApprovals:[],reconciledApprovals:[]};
    this.ticking=true;
    try {
      const auditReport=this.approvalAuditReconciliation?.reconcileAll();
      const reconciledApprovals=auditReport?.repaired.flatMap((item)=>item.repaired) ?? [];
      const expiredApprovals=this.approvalExpiry?.expireDue().expired.map((approval)=>approval.approvalId) ?? [];
      const renewed=this.scheduler.renewLeases();
      const rescheduled=this.scheduler.reconcile();
      const scheduled=this.scheduler.cycle();
      const dispatched:ScheduleDecision[]=[];
      const failedDispatches:Array<{decisionId:string;error:string}>=[];
      for(const decision of scheduled.slice(0,this.maxDispatchPerTick)){
        try{dispatched.push(await this.scheduler.dispatch(decision.decisionId));}
        catch(error){failedDispatches.push({decisionId:decision.decisionId,error:String(error)});}
      }
      return {renewed,rescheduled,scheduled,dispatched,failedDispatches,expiredApprovals,reconciledApprovals};
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
