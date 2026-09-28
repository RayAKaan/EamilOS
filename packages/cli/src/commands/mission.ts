import type { Command } from 'commander';
import { MissionEngine } from '../core/mission/MissionEngine.js';
import { MissionControl } from '../core/mission-interface/MissionControl.js';

export function registerMissionCommand(program: Command): void {
  const mission = program.command('mission').description('Manage Phase 1 mission/task runtime');

  mission
    .command('create <goal>')
    .description('Create a persistent mission')
    .option('--dir <path>', 'Working directory', process.cwd())
    .action(async (goal: string, options: { dir: string }) => {
      const value = await new MissionControl().create({ goal, workingDir: options.dir });
      console.log(JSON.stringify(value, null, 2));
    });

  mission
    .command('list')
    .description('List persistent missions')
    .action(() => {
      console.log(JSON.stringify(new MissionEngine().store.list(), null, 2));
    });

  mission
    .command('show <missionId>')
    .description('Show mission state, tasks, checkpoints and evidence')
    .action((missionId: string) => {
      console.log(JSON.stringify(new MissionEngine().snapshot(missionId), null, 2));
    });

  mission
    .command('start <missionId>')
    .description('Start a mission through the human control plane')
    .action(async (missionId: string) => {
      console.log(JSON.stringify(await new MissionControl().start(missionId), null, 2));
    });


  mission
    .command('add-task <missionId> <title>')
    .description('Add a task to a mission')
    .option('--description <text>', 'Task description')
    .option('--depends-on <ids...>', 'Task IDs that must complete first')
    .option('--priority <priority>', 'CRITICAL, HIGH, MEDIUM, LOW', 'MEDIUM')
    .action((missionId: string, title: string, options: { description?: string; dependsOn?: string[]; priority: string }) => {
      const task = new MissionEngine().addTask(missionId, {
        title,
        description: options.description ?? title,
        dependencies: options.dependsOn,
        priority: options.priority.toUpperCase() as 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW',
      });
      console.log(JSON.stringify(task, null, 2));
    });

  mission
    .command('schedule <missionId>')
    .description('Show deterministic ready-task schedule')
    .action(async (missionId: string) => {
      const { MissionRuntime } = await import('../core/mission/MissionRuntime.js');
      console.log(JSON.stringify(new MissionRuntime(new MissionEngine()).schedule(missionId), null, 2));
    });

  mission
    .command('claim <missionId> <owner>')
    .description('Claim the highest-priority ready task with a lease')
    .option('--ttl <ms>', 'Lease duration in milliseconds', '120000')
    .action(async (missionId: string, owner: string, options: { ttl: string }) => {
      const { MissionRuntime } = await import('../core/mission/MissionRuntime.js');
      console.log(JSON.stringify(
        new MissionRuntime(new MissionEngine()).claimNext(missionId, owner, Number(options.ttl)),
        null,
        2,
      ));
    });

  mission
    .command('check <missionId>')
    .description('Evaluate deterministic mission completion')
    .action((missionId: string) => {
      console.log(JSON.stringify(new MissionEngine().evaluateCompletion(missionId), null, 2));
    });
  mission
    .command('run <goal>')
    .description('Create and run an autonomous mission through the human control plane')
    .option('--dir <path>', 'Working directory', process.cwd())
    .option('--autonomy <level>', 'ASSISTED, PLANNED, or AUTONOMOUS', 'AUTONOMOUS')
    .option('--approve <actions...>', 'Actions requiring human approval')
    .action(async (goal: string, options: { dir: string; autonomy: string; approve?: string[] }) => {
      const control = new MissionControl();
      const mission = await control.create({
        goal,
        workingDir: options.dir,
        autonomy: options.autonomy.toUpperCase() as 'ASSISTED' | 'PLANNED' | 'AUTONOMOUS',
        requireApprovalFor: options.approve?.map(item => item.toUpperCase()) as never,
      });
      const result = await control.start(mission.id);
      console.log(JSON.stringify({ mission, ...result }, null, 2));
    });

  mission
    .command('status <missionId>')
    .description('Show mission status, progress, graph health, loop state, and approvals')
    .action(async (missionId: string) => {
      console.log(JSON.stringify(await new MissionControl().status(missionId), null, 2));
    });

  mission
    .command('dashboard <missionId>')
    .description('Show the human mission dashboard')
    .action(async (id: string) => console.log(await new MissionControl().dashboard(id)));

  mission.command('events <missionId>').description('Show mission event history').action(async (id: string) => console.log(JSON.stringify(await new MissionControl().events(id), null, 2)));
  mission.command('verify <missionId>').description('Verify mission graph consistency').action(async (id: string) => console.log(JSON.stringify(await new MissionControl().verify(id), null, 2)));
  mission.command('why <missionId> <taskId>').description('Explain task dependencies and blockers').action(async (id: string, taskId: string) => console.log(JSON.stringify(await new MissionControl().why(id, taskId), null, 2)));

  mission.command('pause <missionId>').action(async (id: string) => console.log(JSON.stringify(await new MissionControl().pause(id), null, 2)));
  mission.command('continue <missionId>').description('Resume a paused mission').action(async (id: string) => console.log(JSON.stringify(await new MissionControl().resume(id), null, 2)));
  mission.command('resume <missionId>').action(async (id: string) => console.log(JSON.stringify(await new MissionControl().resume(id), null, 2)));
  mission.command('cancel <missionId>').action(async (id: string) => console.log(JSON.stringify(await new MissionControl().cancel(id), null, 2)));
  mission.command('replan <missionId>').action(async (id: string) => console.log(JSON.stringify(await new MissionControl().replan(id), null, 2)));

  mission
    .command('ask <missionId> <request...>')
    .description('Control a mission using bounded natural-language commands')
    .action(async (missionId: string, request: string[]) => {
      console.log(JSON.stringify(await new MissionControl().ask(missionId, request.join(' ')), null, 2));
    });

  const approvals = mission.command('approvals <missionId>').description('Inspect and resolve approval requests');
  approvals.command('list').action(async (missionId: string) => console.log(JSON.stringify(await new MissionControl().approvals.list(missionId), null, 2)));
  approvals.command('approve <approvalId>').action(async (missionId: string, approvalId: string) => console.log(JSON.stringify(await new MissionControl().approve(missionId, approvalId), null, 2)));
  approvals.command('deny <approvalId>').action(async (missionId: string, approvalId: string) => console.log(JSON.stringify(await new MissionControl().deny(missionId, approvalId), null, 2)));

  mission.command('report <missionId>').action(async (id: string) => console.log(JSON.stringify(await new MissionControl().report(id), null, 2)));
  mission
    .command('policy <missionId>')
    .description('Show or update the mission human-control policy')
    .option('--autonomy <level>', 'ASSISTED, PLANNED, or AUTONOMOUS')
    .option('--approve <actions...>', 'Actions requiring human approval')
    .action(async (id: string, options: { autonomy?: string; approve?: string[] }) => {
      const control = new MissionControl();
      if (options.autonomy || options.approve) {
        const value = await control.setPolicy(id, {
          autonomy: options.autonomy?.toUpperCase() as 'ASSISTED' | 'PLANNED' | 'AUTONOMOUS' | undefined,
          requireApprovalFor: options.approve?.map(item => item.toUpperCase()) as never,
        });
        console.log(JSON.stringify(value, null, 2));
      } else {
        console.log(JSON.stringify(await control.getPolicy(id), null, 2));
      }
    });
}
