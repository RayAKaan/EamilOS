import type { Command } from 'commander';
import { MissionEngine } from '../core/mission/MissionEngine.js';
import { MissionControl } from '../core/mission-interface/MissionControl.js';

function output(value: unknown, json?: boolean): void {
  if (json) {
    console.log(JSON.stringify(value, null, 2));
    return;
  }
  if (typeof value === 'string') {
    console.log(value);
    return;
  }
  console.log(JSON.stringify(value, null, 2));
}

function printStatus(value: Awaited<ReturnType<MissionControl['status']>>): void {
  const pct = Math.round(value.progress.completionRatio * 100);
  console.log(`Mission: ${value.missionId}`);
  console.log(`Goal: ${value.goal}`);
  console.log(`Status: ${value.status.toUpperCase()} | Autonomy: ${value.autonomy}`);
  console.log(`Progress: ${value.progress.completedTasks}/${value.progress.totalTasks} tasks (${pct}%)`);
  console.log(`  Running: ${value.progress.runningTasks} | Ready: ${value.progress.readyTasks} | Blocked: ${value.progress.blockedTasks} | Failed: ${value.progress.failedTasks}`);
  console.log(`Graph: v${value.graph.version} | nodes ${value.graph.nodes} | edges ${value.graph.edges} | consistent: ${value.graph.consistent}`);
  if (value.loop) {
    console.log(`Loop: ${value.loop.status} | phase ${value.loop.phase} | iteration ${value.loop.iteration}`);
  }
  const pending = value.approvals.filter(item => item.status === 'PENDING');
  if (pending.length) {
    console.log(`Approvals pending: ${pending.length}`);
    for (const approval of pending) console.log(`  - ${approval.id}: ${approval.action}${approval.taskId ? ` [${approval.taskId}]` : ''} — ${approval.reason}`);
  }
}

function printReport(value: Awaited<ReturnType<MissionControl['report']>>): void {
  console.log(`Mission: ${value.missionId}`);
  console.log(`Status: ${value.status.toUpperCase()}`);
  console.log(value.summary);
  console.log(`Progress: ${value.progress.completedTasks}/${value.progress.totalTasks} (${Math.round(value.progress.completionRatio * 100)}%)`);
  console.log(`Tasks: completed ${value.tasks.completed.length}, running ${value.tasks.running.length}, ready ${value.tasks.ready.length}, blocked ${value.tasks.blocked.length}, failed ${value.tasks.failed.length}`);
  console.log(`Artifacts: ${value.artifacts.length} | Evidence: ${value.evidence.length} | Checkpoints: ${value.checkpoints.length}`);
  console.log(`Decisions: ${value.decisions} | Mission events: ${value.events}`);
}

export function registerMissionCommand(program: Command): void {
  const mission = program.command('mission').description('Create, run, inspect, and control autonomous missions');

  mission.command('create <goal>')
    .description('Create a persistent mission')
    .option('--dir <path>', 'Working directory', process.cwd())
    .option('--autonomy <level>', 'ASSISTED, PLANNED, or AUTONOMOUS', 'AUTONOMOUS')
    .option('--approve <actions...>', 'Actions requiring human approval')
    .option('--json', 'Output JSON')
    .action(async (goal: string, options: { dir: string; autonomy: string; approve?: string[]; json?: boolean }) => {
      const value = await new MissionControl().create({
        goal, workingDir: options.dir,
        autonomy: options.autonomy.toUpperCase() as 'ASSISTED' | 'PLANNED' | 'AUTONOMOUS',
        requireApprovalFor: options.approve?.map(item => item.toUpperCase()) as never,
      });
      output(value, options.json);
    });

  mission.command('list')
    .description('List persistent missions')
    .option('--json', 'Output JSON')
    .action((options: { json?: boolean }) => {
      const values = new MissionEngine().store.list();
      if (options.json) return output(values, true);
      if (!values.length) return console.log('No missions found.');
      for (const item of values) console.log(`${item.id} | ${item.status.toUpperCase()} | ${item.goal}`);
    });

  mission.command('show <missionId>')
    .description('Show mission state')
    .option('--json', 'Output JSON')
    .action((missionId: string, options: { json?: boolean }) => {
      const value = new MissionEngine().snapshot(missionId);
      output(value, options.json);
    });

  mission.command('run <goal>')
    .description('Create and run an autonomous mission')
    .option('--dir <path>', 'Working directory', process.cwd())
    .option('--autonomy <level>', 'ASSISTED, PLANNED, or AUTONOMOUS', 'AUTONOMOUS')
    .option('--approve <actions...>', 'Actions requiring human approval')
    .option('--json', 'Output JSON')
    .action(async (goal: string, options: { dir: string; autonomy: string; approve?: string[]; json?: boolean }) => {
      const control = new MissionControl();
      const mission = await control.create({
        goal, workingDir: options.dir,
        autonomy: options.autonomy.toUpperCase() as 'ASSISTED' | 'PLANNED' | 'AUTONOMOUS',
        requireApprovalFor: options.approve?.map(item => item.toUpperCase()) as never,
      });
      const result = await control.start(mission.id);
      if (options.json) return output({ mission, ...result }, true);
      console.log(`Mission created: ${mission.id}`);
      if (!result.started) {
        console.log(`Approval required: ${result.approval?.id} (${result.approval?.action})`);
        console.log(`Run: eamilos mission approve ${mission.id} ${result.approval?.id}`);
        return;
      }
      console.log(`Mission finished with status: ${result.result?.status}`);
      if (result.result) console.log(`Loop: ${result.result.loop.iterations} iterations, ${result.result.loop.executions} executions`);
    });

  mission.command('start <missionId>')
    .description('Start or resume a mission')
    .option('--json', 'Output JSON')
    .action(async (missionId: string, options: { json?: boolean }) => {
      const value = await new MissionControl().start(missionId);
      if (!options.json && !value.started) {
        console.log(`Approval required: ${value.approval?.id} (${value.approval?.action})`);
        console.log(`Run: eamilos mission approve ${missionId} ${value.approval?.id}`);
        return;
      }
      output(value, options.json);
    });

  mission.command('status <missionId>')
    .description('Show mission status, progress, graph health, loop state, and approvals')
    .option('--json', 'Output JSON')
    .action(async (missionId: string, options: { json?: boolean }) => {
      const value = await new MissionControl().status(missionId);
      if (options.json) return output(value, true);
      printStatus(value);
    });

  mission.command('pause <missionId>')
    .description('Pause a mission')
    .option('--json', 'Output JSON')
    .action(async (id: string, options: { json?: boolean }) => {
      const value = await new MissionControl().pause(id);
      output(value, options.json);
    });

  mission.command('resume <missionId>')
    .description('Resume a paused mission')
    .option('--json', 'Output JSON')
    .action(async (id: string, options: { json?: boolean }) => {
      const value = await new MissionControl().resume(id);
      if (!options.json && !value.started) {
        console.log(`Approval required: ${value.approval?.id} (${value.approval?.action})`);
        console.log(`Run: eamilos mission approve ${id} ${value.approval?.id}`);
        return;
      }
      output(value, options.json);
    });

  mission.command('cancel <missionId>')
    .description('Cancel a mission')
    .option('--json', 'Output JSON')
    .action(async (id: string, options: { json?: boolean }) => output(await new MissionControl().cancel(id), options.json));

  mission.command('replan <missionId>')
    .description('Ask the autonomous runtime to replan')
    .option('--json', 'Output JSON')
    .action(async (id: string, options: { json?: boolean }) => {
      const value = await new MissionControl().replan(id);
      if (!options.json && !value.started) {
        console.log(`Approval required: ${value.approval?.id} (${value.approval?.action})`);
        console.log(`Run: eamilos mission approve ${id} ${value.approval?.id}`);
        return;
      }
      output(value, options.json);
    });

  mission.command('policy <missionId>')
    .description('Show or update the mission human-control policy')
    .option('--autonomy <level>', 'ASSISTED, PLANNED, or AUTONOMOUS')
    .option('--approve <actions...>', 'Actions requiring approval')
    .option('--json', 'Output JSON')
    .action(async (id: string, options: { autonomy?: string; approve?: string[]; json?: boolean }) => {
      const control = new MissionControl();
      const value = await control.setPolicy(id, {
        autonomy: options.autonomy?.toUpperCase() as 'ASSISTED' | 'PLANNED' | 'AUTONOMOUS' | undefined,
        requireApprovalFor: options.approve?.map(item => item.toUpperCase()) as never,
      });
      output(value, options.json);
    });

  mission.command('approvals <missionId>')
    .description('List approval requests')
    .option('--json', 'Output JSON')
    .action(async (id: string, options: { json?: boolean }) => {
      const value = await new MissionControl().approvals.list(id);
      output(value, options.json);
    });

  mission.command('approve <missionId> <approvalId>')
    .description('Approve a pending mission action')
    .option('--json', 'Output JSON')
    .action(async (missionId: string, approvalId: string, options: { json?: boolean }) => {
      output(await new MissionControl().approve(missionId, approvalId), options.json);
    });

  mission.command('deny <missionId> <approvalId>')
    .description('Deny a pending mission action')
    .option('--json', 'Output JSON')
    .action(async (missionId: string, approvalId: string, options: { json?: boolean }) => {
      output(await new MissionControl().deny(missionId, approvalId), options.json);
    });

  mission.command('report <missionId>')
    .description('Show the final/ current mission report')
    .option('--json', 'Output JSON')
    .action(async (id: string, options: { json?: boolean }) => {
      const value = await new MissionControl().report(id);
      if (options.json) return output(value, true);
      printReport(value);
    });

  mission.command('history <missionId>')
    .description('Show mission and autonomous-loop event history')
    .option('--json', 'Output JSON')
    .option('--limit <n>', 'Maximum entries', '50')
    .action(async (id: string, options: { json?: boolean; limit: string }) => {
      const value = await new MissionControl().history(id);
      const limited = value.slice(-Math.max(1, Number(options.limit)));
      if (options.json) return output(limited, true);
      for (const event of limited) {
        const detail = event.taskId ? ` task=${event.taskId}` : '';
        console.log(`${event.timestamp} [${event.source}] ${event.type}${detail}`);
      }
    });

  mission.command('why <missionId> <taskId>')
    .description('Explain why a task is blocked/running/failed')
    .option('--json', 'Output JSON')
    .action(async (missionId: string, taskId: string, options: { json?: boolean }) => {
      const value = await new MissionControl().why(missionId, taskId);
      if (options.json) return output(value, true);
      console.log(`Task: ${taskId}`);
      console.log(`Dependencies: ${value.dependencies.map((item: any) => item.id).join(', ') || 'none'}`);
      console.log(`Blockers: ${value.blockers.map((item: any) => item.id).join(', ') || 'none'}`);
      console.log(`Failures: ${value.failures.map((item: any) => item.id).join(', ') || 'none'}`);
      console.log(`Executions: ${value.executions.map((item: any) => item.id).join(', ') || 'none'}`);
      console.log(`Decisions: ${value.decisions.map((item: any) => item.id).join(', ') || 'none'}`);
    });

  mission.command('verify <missionId>')
    .description('Verify graph and loop integrity')
    .option('--json', 'Output JSON')
    .action(async (id: string, options: { json?: boolean }) => {
      const value = await new MissionControl().verify(id);
      if (options.json) return output(value, true);
      console.log(`Graph: ${value.graph.consistent ? 'PASS' : 'FAIL'} | Loop event chain: ${value.loopIntegrity ? 'PASS' : 'FAIL'}`);
      if (!value.graph.consistent || !value.loopIntegrity) process.exitCode = 1;
    });

  mission.command('ask <missionId> <request...>')
    .description('Use bounded natural-language mission control')
    .action(async (missionId: string, request: string[]) => {
      const value = await new MissionControl().ask(missionId, request.join(' '));
      console.log(value.message);
      console.log(JSON.stringify(value.data ?? {}, null, 2));
    });
}
