import type { DistributedNodeView, DistributedMissionSnapshot } from '../distributed-mission/index.js';

export interface FleetIntelligenceContext {
  nodes: DistributedNodeView[];
  mission?: DistributedMissionSnapshot;
  healthyNodeCount: number;
  capableNodeCount: number;
  activeAssignments: number;
  recoverableAssignments: number;
}

export interface FleetIntelligenceProvider {
  snapshot(missionId?: string): FleetIntelligenceContext;
}

export class StaticFleetIntelligenceProvider implements FleetIntelligenceProvider {
  constructor(
    private readonly nodes: () => DistributedNodeView[],
    private readonly mission?: () => DistributedMissionSnapshot | undefined,
  ) {}

  snapshot(): FleetIntelligenceContext {
    const nodes = this.nodes();
    const mission = this.mission?.();
    const activeAssignments = mission?.assignments.filter(
      (assignment) => !['COMPLETED', 'FAILED', 'REJECTED', 'REQUEUED'].includes(assignment.state),
    ).length ?? 0;
    const recoverableAssignments = mission?.assignments.filter(
      (assignment) => assignment.state === 'REQUEUED' || assignment.state === 'FAILED',
    ).length ?? 0;
    return {
      nodes,
      mission,
      healthyNodeCount: nodes.filter((node) => node.state === 'online').length,
      capableNodeCount: nodes.filter((node) => node.state !== 'offline' && node.maxConcurrentTasks > node.activeTasks).length,
      activeAssignments,
      recoverableAssignments,
    };
  }
}
