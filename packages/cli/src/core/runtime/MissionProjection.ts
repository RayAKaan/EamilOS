import type { RuntimeEvent } from './types.js';

export interface MissionProjection<T> {
  readonly id: string;
  initial(): T;
  apply(state: T, event: RuntimeEvent): T;
}

export class ProjectionRegistry<T> {
  private readonly projections = new Map<string, MissionProjection<T>>();

  register(projection: MissionProjection<T>): () => void {
    if (this.projections.has(projection.id)) throw new Error(`Projection already registered: ${projection.id}`);
    this.projections.set(projection.id, projection);
    return () => this.projections.delete(projection.id);
  }

  get(id: string): MissionProjection<T> | undefined {
    return this.projections.get(id);
  }

  list(): string[] {
    return [...this.projections.keys()].sort();
  }

  reduce(id: string, events: readonly RuntimeEvent[]): T {
    const projection = this.projections.get(id);
    if (!projection) throw new Error(`Unknown projection: ${id}`);
    return events.reduce((state, event) => projection.apply(state, event), projection.initial());
  }
}
