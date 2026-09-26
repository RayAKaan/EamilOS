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
    .command('check <missionId>')
    .description('Evaluate deterministic mission completion')
    .action((missionId: string) => {
      console.log(JSON.stringify(new MissionEngine().evaluateCompletion(missionId), null, 2));
    });
}
