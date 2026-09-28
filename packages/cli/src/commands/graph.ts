import { GraphBuilder, GraphQueryEngine, GraphValidator, FilesystemGraphStore } from '../core/cognitive-graph/index.js';
import { MissionEngine } from '../core/mission/MissionEngine.js';

export interface GraphCommandOptions { json?: boolean; }

function render(value: unknown, json = false): void {
  console.log(json ? JSON.stringify(value, null, 2) : value);
}

function missionSnapshot(missionId: string) {
  return new MissionEngine().snapshot(missionId);
}

export async function graphShow(missionId: string, options: GraphCommandOptions = {}): Promise<void> {
  const graph = new GraphBuilder().build(missionSnapshot(missionId));
  await new FilesystemGraphStore().save(graph);
  if (options.json) return render(graph, true);
  console.log('Cognitive Execution Graph');
  console.log(`Mission: ${graph.missionId}`);
  console.log(`Version: ${graph.version}`);
  console.log(`State hash: ${graph.stateHash}`);
  console.log(`Nodes: ${graph.nodes.length}`);
  console.log(`Edges: ${graph.edges.length}`);
  console.log(`Tasks: ${graph.nodes.filter(n => n.type === 'TASK').length}`);
  console.log(`Artifacts: ${graph.nodes.filter(n => n.type === 'ARTIFACT').length}`);
  console.log(`Evidence: ${graph.nodes.filter(n => n.type === 'EVIDENCE').length}`);
  console.log(`Checkpoints: ${graph.nodes.filter(n => n.type === 'CHECKPOINT').length}`);
}

export async function graphVerify(missionId: string, options: GraphCommandOptions = {}): Promise<void> {
  const graph = new GraphBuilder().build(missionSnapshot(missionId));
  const health = new GraphValidator().validate(graph);
  if (options.json) return render(health, true);
  console.log(`Graph verification: ${health.consistent ? 'PASS' : 'FAIL'}`);
  console.log(`Version: ${health.version}`);
  console.log(`Nodes: ${health.nodeCount}`);
  console.log(`Edges: ${health.edgeCount}`);
  console.log(`Orphan edges: ${health.orphanEdges}`);
  console.log(`Invalid references: ${health.invalidReferences}`);
  console.log(`State hash: ${health.stateHash}`);
  if (!health.consistent) process.exitCode = 1;
}

export async function graphWhy(missionId: string, taskId: string, options: GraphCommandOptions = {}): Promise<void> {
  const graph = new GraphBuilder().build(missionSnapshot(missionId));
  const query = new GraphQueryEngine(graph);
  const task = query.getNode(taskId);
  if (!task || task.type !== 'TASK') throw new Error(`Task not found in graph: ${taskId}`);
  const result = {
    task,
    blockers: query.findBlockers(taskId),
    failures: query.findFailures(taskId),
    dependencyIds: query.findDependencies(taskId).map(n => n.id),
    dependentIds: query.findDependents(taskId).map(n => n.id),
  };
  if (options.json) return render(result, true);
  console.log(`Task: ${taskId}`);
  console.log(`State: ${String(task.attributes.state)}`);
  console.log(`Dependencies: ${result.dependencyIds.join(', ') || 'none'}`);
  console.log(`Blockers: ${result.blockers.map(n => `${n.id} (${String(n.attributes.state)})`).join(', ') || 'none'}`);
  console.log(`Failures: ${result.failures.map(n => n.id).join(', ') || 'none'}`);
}
