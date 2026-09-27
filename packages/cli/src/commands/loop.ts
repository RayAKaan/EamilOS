import type { Command } from 'commander';
import { AutonomousLoopEngine, LoopEventLog, LoopStateStore, createAutonomousLoopRuntime } from '../core/loop/index.js';

export function registerLoopCommand(program: Command): void {
  const loop = program.command('loop').description('Run and inspect the autonomous Observe → Interpret → Plan → Execute → Measure → Validate → Adapt loop');

  loop.command('run <missionId>')
    .description('Run the autonomous mission loop')
    .action(async (missionId: string) => {
      const runtime = createAutonomousLoopRuntime();
      console.log(JSON.stringify(await runtime.run(missionId), null, 2));
    });

  loop.command('status <missionId>')
    .description('Show persisted autonomous loop state')
    .action(async (missionId: string) => {
      const state = await new LoopStateStore().load(missionId);
      if (!state) throw new Error(`No autonomous loop state exists for mission ${missionId}`);
      console.log(JSON.stringify(state, null, 2));
    });

  loop.command('pause <missionId>')
    .description('Pause an active autonomous loop')
    .action(async (missionId: string) => {
      const runtime = createAutonomousLoopRuntime();
      console.log(JSON.stringify(await runtime.pause(missionId), null, 2));
    });

  loop.command('events <missionId>')
    .description('Show the tamper-evident autonomous loop event history')
    .action(async (missionId: string) => {
      const events = await new LoopEventLog().all(missionId);
      console.log(JSON.stringify(events, null, 2));
    });

  loop.command('verify <missionId>')
    .description('Verify the autonomous loop event hash chain')
    .action(async (missionId: string) => {
      const valid = await new LoopEventLog().verify(missionId);
      console.log(JSON.stringify({ missionId, valid }, null, 2));
      if (!valid) process.exitCode = 1;
    });
}
