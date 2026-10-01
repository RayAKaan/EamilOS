import type { FabricNodeRecord } from '../fabric/types.js';

export interface FleetTask {
  id: string;
  requiredHarnesses?: string[];
  requiredModels?: string[];
  requiredTools?: string[];
  preferredNodeId?: string;
}

export interface FleetAssignment {
  taskId: string;
  nodeId?: string;
  reason: string;
}

export class FleetScheduler {
  assign(tasks: readonly FleetTask[], nodes: readonly FabricNodeRecord[]): FleetAssignment[] {
    return tasks.map(task => {
      const candidates = nodes
        .filter(n => n.state === 'online')
        .filter(n => n.activeTasks < n.capabilities.maxConcurrentTasks)
        .filter(n => (task.requiredHarnesses ?? []).every(h => n.capabilities.harnesses.includes(h)))
        .filter(n => (task.requiredModels ?? []).every(m => n.capabilities.models.includes(m)))
        .filter(n => (task.requiredTools ?? []).every(t => n.capabilities.tools.includes(t)));

      const preferred = candidates.find(n => n.identity.nodeId === task.preferredNodeId);
      const node = preferred ?? candidates.sort((a, b) => a.activeTasks - b.activeTasks || a.identity.nodeId.localeCompare(b.identity.nodeId))[0];
      return {
        taskId: task.id,
        nodeId: node?.identity.nodeId,
        reason: node ? (preferred ? 'preferred-node' : 'capability-and-load-fit') : 'no-capable-node',
      };
    });
  }
}
