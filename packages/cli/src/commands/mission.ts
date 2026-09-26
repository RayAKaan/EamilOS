import type { Command } from 'commander';
import { MissionEngine } from '../core/mission/MissionEngine.js';

export function registerMissionCommand(program: Command): void {
  const mission = program.command('mission').description('Manage Phase 1 mission/task runtime');

  mission
    .command('create <goal>')
    .description('Create a persistent mission')
    .option('--dir <path>', 'Working directory', process.cwd())
    .action((goal: string, options: { dir: string }) => {
      const engine = new MissionEngine();
      const value = engine.createMission({ goal, workingDir: options.dir });
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
    .description('Start a created or paused mission')
    .action((missionId: string) => {
      console.log(JSON.stringify(new MissionEngine().start(missionId), null, 2));
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
    .command('plan <missionId> <taskId> <agentId>')
    .description('Submit an agent-local TODO plan proposal')
    .requiredOption('--objective <text>', 'Agent objective')
    .requiredOption('--todo <json>', 'JSON array of TODOs with resource claims')
    .action((missionId: string, taskId: string, agentId: string, options: { objective: string; todo: string }) => {
      const { AgentPlanCoordinator } = require('../core/mission/AgentPlanCoordinator.js') as typeof import('../core/mission/AgentPlanCoordinator.js');
      const todos = JSON.parse(options.todo);
      const result = new AgentPlanCoordinator().submit({
        missionId,
        taskId,
        agentId,
        objective: options.objective,
        todos,
      });
      console.log(JSON.stringify(result, null, 2));
    });

  mission
    .command('plans <taskId>')
    .description('Show all agent-local plans submitted for a task')
    .action((taskId: string) => {
      const { AgentPlanStore } = require('../core/mission/AgentPlanStore.js') as typeof import('../core/mission/AgentPlanStore.js');
      console.log(JSON.stringify(new AgentPlanStore().listForTask(taskId), null, 2));
    });

  mission
    .command('check <missionId>')
    .description('Evaluate deterministic mission completion')
    .action((missionId: string) => {
      console.log(JSON.stringify(new MissionEngine().evaluateCompletion(missionId), null, 2));
    });
}
