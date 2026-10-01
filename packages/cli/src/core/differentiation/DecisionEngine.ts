export interface DecisionOption<T = unknown> {
  id: string;
  description: string;
  execute: () => Promise<T> | T;
  expectedCost?: number;
  risk?: number;
  confidence?: number;
}

export interface DecisionRecord {
  id: string;
  selectedOption: string;
  rationale: string[];
  confidence: number;
  createdAt: string;
}

export class DecisionEngine {
  async decide<T>(options: readonly DecisionOption<T>[]): Promise<{ record: DecisionRecord; result: T }> {
    if (!options.length) throw new Error('Decision requires at least one option');
    const ranked = [...options].sort((a, b) => this.score(b) - this.score(a) || a.id.localeCompare(b.id));
    const selected = ranked[0];
    const confidence = selected.confidence ?? 0.5;
    const rationale = [
      `expected-cost=${selected.expectedCost ?? 0}`,
      `risk=${selected.risk ?? 0}`,
      `confidence=${confidence}`,
    ];
    const result = await selected.execute();
    return {
      record: {
        id: `decision_${Date.now()}_${selected.id}`,
        selectedOption: selected.id,
        rationale,
        confidence,
        createdAt: new Date().toISOString(),
      },
      result,
    };
  }

  private score(option: DecisionOption): number {
    return (option.confidence ?? 0.5) * 100 - (option.risk ?? 0) * 20 - (option.expectedCost ?? 0);
  }
}
