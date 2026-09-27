import type { MissionSnapshot } from '../mission/types.js';
import { CognitiveGraph } from './CognitiveGraph.js';
import { GraphValidator } from './GraphValidator.js';
import type { GraphSource } from './types.js';

export class GraphBuilder {
  build(snapshot: MissionSnapshot): ReturnType<CognitiveGraph['snapshot']> {
    const graph = new CognitiveGraph(snapshot.mission.id);
    const source = (sourceId: string): GraphSource => ({ kind: 'MISSION', sourceId });
    graph.addNode({ id: snapshot.mission.id, type: 'MISSION', source: source(snapshot.mission.id), attributes: {
      goal: snapshot.mission.goal, status: snapshot.mission.status, workingDir: snapshot.mission.workingDir,
    }});
    for (const task of snapshot.tasks) {
      graph.addNode({ id: task.id, type: 'TASK', source: source(task.id), attributes: {
        title: task.title, state: task.state, priority: task.priority, attempt: task.attempt,
        requiredCapabilities: task.requiredCapabilities, acceptanceCriteria: task.acceptanceCriteria,
      }});
      graph.addEdge({ id: `contains:${snapshot.mission.id}:${task.id}`, type: 'CONTAINS', from: snapshot.mission.id, to: task.id, source: source(snapshot.mission.id) });
      for (const dependency of task.dependencies) {
        graph.addEdge({ id: `depends:${task.id}:${dependency}`, type: 'DEPENDS_ON', from: dependency, to: task.id, source: source(task.id) });
      }
      for (const capability of task.requiredCapabilities) {
        const capabilityId = `capability:${capability}`;
        if (!graph.getNode(capabilityId)) graph.addNode({ id: capabilityId, type: 'CAPABILITY', source: source(capabilityId), attributes: { name: capability }});
        graph.addEdge({ id: `requires:${task.id}:${capability}`, type: 'REQUIRES', from: task.id, to: capabilityId, source: source(task.id) });
      }
      for (const artifact of task.artifacts) {
        const artifactId = `artifact:${task.id}:${artifact}`;
        graph.addNode({ id: artifactId, type: 'ARTIFACT', source: source(artifactId), attributes: { path: artifact }});
        graph.addEdge({ id: `produces:${task.id}:${artifactId}`, type: 'PRODUCES', from: task.id, to: artifactId, source: source(task.id) });
      }
    }
    for (const evidence of snapshot.evidence) {
      graph.addNode({ id: evidence.id, type: 'EVIDENCE', source: source(evidence.id), attributes: {
        type: evidence.type, description: evidence.description, passed: evidence.passed, reference: evidence.reference,
      }});
      if (evidence.taskId && graph.getNode(evidence.taskId)) graph.addEdge({ id: `evidence:${evidence.taskId}:${evidence.id}`, type: 'VALIDATED_BY', from: evidence.taskId, to: evidence.id, source: source(evidence.id) });
    }
    for (const checkpoint of snapshot.checkpoints) {
      graph.addNode({ id: checkpoint.id, type: 'CHECKPOINT', source: source(checkpoint.id), attributes: {
        taskId: checkpoint.taskId, status: checkpoint.status, completedSteps: checkpoint.completedSteps,
        remainingSteps: checkpoint.remainingSteps, artifacts: checkpoint.artifacts, evidenceIds: checkpoint.evidenceIds,
      }});
      if (graph.getNode(checkpoint.taskId)) graph.addEdge({ id: `checkpoint:${checkpoint.taskId}:${checkpoint.id}`, type: 'CHECKPOINTED_BY', from: checkpoint.taskId, to: checkpoint.id, source: source(checkpoint.id) });
    }
    const result = graph.commitVersion();
    new GraphValidator().assertValid(result);
    return result;
  }
}
