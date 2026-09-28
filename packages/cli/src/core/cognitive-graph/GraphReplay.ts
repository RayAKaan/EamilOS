import type { GraphSnapshot, GraphEvent } from './types.js';

export interface GraphReplayAdapter {
  apply(snapshot: GraphSnapshot, event: GraphEvent): GraphSnapshot;
}

export class GraphReplay {
  constructor(private readonly adapter: GraphReplayAdapter) {}

  replay(initial: GraphSnapshot, events: GraphEvent[], targetVersion?: number): GraphSnapshot {
    let current = initial;
    for (const event of [...events].sort((a, b) => a.sequence - b.sequence)) {
      if (event.version <= current.version) continue;
      if (targetVersion !== undefined && event.version > targetVersion) break;
      current = this.adapter.apply(current, event);
    }
    return current;
  }
}
