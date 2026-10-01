import { HarnessCompetition } from './HarnessCompetition.js';
import { CrossHarnessDelegator } from './CrossHarnessDelegator.js';
import { MissionOptimizer } from './MissionOptimizer.js';
import { FleetScheduler } from './FleetScheduler.js';
import { CognitiveGraph } from './CognitiveGraph.js';
import { DecisionEngine } from './DecisionEngine.js';
import { AutonomousRecovery } from './AutonomousRecovery.js';
import { EvidenceGraph } from './EvidenceGraph.js';

export class PhaseFDifferentiationRuntime {
  readonly harnessCompetition = new HarnessCompetition();
  readonly crossHarnessDelegator = new CrossHarnessDelegator();
  readonly missionOptimizer = new MissionOptimizer();
  readonly fleetScheduler = new FleetScheduler();
  readonly cognitiveGraph = new CognitiveGraph();
  readonly decisionEngine = new DecisionEngine();
  readonly autonomousRecovery = new AutonomousRecovery();
  readonly evidenceGraph = new EvidenceGraph();
}
