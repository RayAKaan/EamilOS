import type { Command } from 'commander';
import { MissionEngine } from '../core/mission/MissionEngine.js';
import { createIntelligenceRuntime } from '../core/intelligence/IntelligenceFactory.js';
import { DecisionContextBuilder } from '../core/intelligence/DecisionContextBuilder.js';
import { DecisionStore } from '../core/intelligence/DecisionStore.js';
import { CoordinationEngine } from '../core/coordination/CoordinationEngine.js';

export function registerIntelligenceCommand(program: Command): void {
  const intelligence = program.command('intelligence').description('Run Jev + Laya strategic intelligence');

  intelligence.command('context <missionId>')
    .description('Build the structured DecisionContext sent to Jev')
    .action((missionId: string) => {
      const missions = new MissionEngine();
      const coordination = new CoordinationEngine(missions);
      const context = new DecisionContextBuilder(missions, coordination);
      console.log(JSON.stringify(context.build(missionId), null, 2));
    });

  intelligence.command('decide <missionId>')
    .description('Request and validate one bounded Jev decision')
    .action(async (missionId: string) => {
      const runtime = createIntelligenceRuntime();
      const result = await runtime.decide(missionId);
      console.log(JSON.stringify(result, null, 2));
    });

  intelligence.command('run <missionId>')
    .description('Run the bounded autonomous Jev → Laya → EamilOS loop')
    .action(async (missionId: string) => {
      const missions = new MissionEngine();
      const mission = missions.snapshot(missionId).mission;
      if (mission.status === 'created') missions.start(missionId);
      const runtime = createIntelligenceRuntime({ missions });
      console.log(JSON.stringify(await runtime.run(missionId), null, 2));
    });

  intelligence.command('history <missionId>')
    .description('Show persisted strategic decisions')
    .action((missionId: string) => {
      console.log(JSON.stringify(new DecisionStore().getDecisions(missionId), null, 2));
    });
}