import type { Command } from 'commander';
import { readFile } from 'fs/promises';
import { CoordinationEngine } from '../core/coordination/CoordinationEngine.js';
import { MissionEngine } from '../core/mission/MissionEngine.js';
import { TaskProposalSchema } from '../core/coordination/types.js';

export function registerCoordinationCommand(program: Command): void {
  const coordination = program.command('coordination').description('Phase 1.5 agent planning and reconciliation');

  coordination
    .command('show <missionId>')
    .description('Show coordination state, proposals, local plans, conflicts and reservations')
    .action((missionId: string) => {
      console.log(JSON.stringify(new CoordinationEngine(new MissionEngine()).snapshot(missionId), null, 2));
    });

  coordination
    .command('submit <missionId> <file>')
    .description('Submit a JSON array of non-authoritative task proposals')
    .action(async (missionId: string, file: string) => {
      const raw = JSON.parse(await readFile(file, 'utf8'));
      if (!Array.isArray(raw)) throw new Error('Proposal file must contain a JSON array');
      const proposals = raw.map((item) => TaskProposalSchema.parse(item));
      const result = new CoordinationEngine(new MissionEngine()).submitProposals(missionId, proposals);
      console.log(JSON.stringify(result, null, 2));
    });

  coordination
    .command('plan <missionId> <agentId>')
    .description('Build an agent-local TODO plan from authoritative tasks')
    .option('--tasks <ids...>', 'Optional authoritative task IDs')
    .action((missionId: string, agentId: string, options: { tasks?: string[] }) => {
      const result = new CoordinationEngine(new MissionEngine()).buildLocalPlan(
        missionId,
        agentId,
        options.tasks,
      );
      console.log(JSON.stringify(result, null, 2));
    });

  coordination
    .command('reconcile <missionId> <planFile>')
    .description('Reconcile an agent-local plan against current authoritative state')
    .action(async (missionId: string, planFile: string) => {
      const plan = JSON.parse(await readFile(planFile, 'utf8'));
      const result = new CoordinationEngine(new MissionEngine()).reconcileLocalPlan(missionId, plan);
      console.log(JSON.stringify(result, null, 2));
    });
}
