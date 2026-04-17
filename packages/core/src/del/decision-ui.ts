import * as readline from 'readline';
import { DecisionRequest, DecisionResponse } from './decision-types.js';

export interface DecisionUIConfig {
  showConfidence: boolean;
  showRecommended: boolean;
  keyboardNavigation: boolean;
  clearOnExit: boolean;
}

const DEFAULT_UI_CONFIG: DecisionUIConfig = {
  showConfidence: true,
  showRecommended: true,
  keyboardNavigation: true,
  clearOnExit: true,
};

export class DecisionUI {
  private config: DecisionUIConfig;
  private rl: readline.Interface | null = null;

  constructor(config?: Partial<DecisionUIConfig>) {
    this.config = { ...DEFAULT_UI_CONFIG, ...config };
  }

  async prompt(request: DecisionRequest): Promise<DecisionResponse> {
    this.displayRequest(request);

    const selected = await this.awaitSelection(request);

    return {
      id: `response_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      requestId: request.id,
      selected,
      source: 'user',
      timestamp: Date.now(),
    };
  }

  private displayRequest(request: DecisionRequest): void {
    console.log('\n' + '='.repeat(60));
    console.log('⬡ DECISION REQUIRED');
    console.log('='.repeat(60));
    console.log(`\n${request.question}\n`);

    if (request.context?.failureType) {
      console.log(`Context: ${request.context.failureType} (attempt ${request.context.attempt || 1})`);
    }

    if (this.config.showRecommended && request.recommended) {
      const conf = request.confidence?.[request.recommended];
      console.log(`\nRecommended: ${request.recommended}${conf !== undefined ? ` (${(conf * 100).toFixed(0)}% confidence)` : ''}`);
    }

    if (this.config.showConfidence && request.confidence) {
      console.log('\nConfidence scores:');
      for (const [option, score] of Object.entries(request.confidence)) {
        const bar = this.createConfidenceBar(score);
        console.log(`  ${option}: ${bar} ${(score * 100).toFixed(0)}%`);
      }
    }

    console.log('\n' + '-'.repeat(60));
    console.log('Options: [');
    for (let i = 0; i < request.options.length; i++) {
      const option = request.options[i];
      const prefix = i === 0 ? '→' : ' ';
      const isRecommended = option === request.recommended;
      console.log(`${prefix} ${option}${isRecommended ? ' ★' : ''}`);
    }
    console.log(']');
    console.log('-'.repeat(60));

    if (!this.config.keyboardNavigation) {
      console.log('\nEnter your choice (number or text):');
    }
  }

  private createConfidenceBar(score: number): string {
    const width = 20;
    const filled = Math.round(score * width);
    const filledChars = '█'.repeat(filled);
    const emptyChars = '░'.repeat(width - filled);
    return filledChars + emptyChars;
  }

  private awaitSelection(request: DecisionRequest): Promise<string> {
    return new Promise((resolve) => {
      if (this.config.keyboardNavigation) {
        this.handleKeyboardInput(request, resolve);
      } else {
        this.handleTextInput(request, resolve);
      }
    });
  }

  private handleKeyboardInput(request: DecisionRequest, resolve: (selection: string) => void): void {
    let selectedIndex = request.options.findIndex(o => o === request.recommended);
    if (selectedIndex === -1) selectedIndex = 0;

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    this.displaySelection(request, selectedIndex);

    process.stdin.setRawMode(true);

    const handleKey = (chunk: Buffer | string): void => {
      const key = chunk.toString();

      if (key === '\r' || key === '\n') {
        process.stdin.removeListener('data', handleKey);
        process.stdin.setRawMode(false);
        if (this.config.clearOnExit) {
          this.clearLines(request.options.length + 15);
        }
        resolve(request.options[selectedIndex]);
        return;
      }

      if (key === '\x1b') {
        process.stdin.removeListener('data', handleKey);
        process.stdin.setRawMode(false);
        if (this.config.clearOnExit) {
          this.clearLines(request.options.length + 15);
        }
        resolve(request.defaultOption || request.options[0]);
        return;
      }

      if (key === '\x1b[A' || key === 'k') {
        selectedIndex = Math.max(0, selectedIndex - 1);
      } else if (key === '\x1b[B' || key === 'j') {
        selectedIndex = Math.min(request.options.length - 1, selectedIndex + 1);
      } else if (key === 'h' || key === '\x1b[D') {
        selectedIndex = Math.max(0, selectedIndex - 1);
      } else if (key === 'l' || key === '\x1b[C') {
        selectedIndex = Math.min(request.options.length - 1, selectedIndex + 1);
      }

      this.displaySelection(request, selectedIndex);
    };

    process.stdin.on('data', handleKey);
  }

  private displaySelection(request: DecisionRequest, selectedIndex: number): void {
    this.clearLines(request.options.length);

    for (let i = 0; i < request.options.length; i++) {
      const option = request.options[i];
      const prefix = i === selectedIndex ? '→' : ' ';
      const isRecommended = option === request.recommended;
      const highlight = i === selectedIndex ? '\x1b[1;32m' : '\x1b[0m';
      const rec = isRecommended ? ' ★' : '';
      console.log(`${highlight}${prefix} ${option}${rec}\x1b[0m`);
    }
  }

  private handleTextInput(request: DecisionRequest, resolve: (selection: string) => void): void {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    this.rl.question('> ', (answer) => {
      this.rl?.close();

      if (this.config.clearOnExit) {
        this.clearLines(20);
      }

      const trimmed = answer.trim().toLowerCase();

      const numericIndex = parseInt(trimmed, 10) - 1;
      if (!isNaN(numericIndex) && numericIndex >= 0 && numericIndex < request.options.length) {
        resolve(request.options[numericIndex]);
        return;
      }

      const exactMatch = request.options.find(
        o => o.toLowerCase() === trimmed
      );
      if (exactMatch) {
        resolve(exactMatch);
        return;
      }

      const partialMatch = request.options.find(
        o => o.toLowerCase().includes(trimmed)
      );
      if (partialMatch) {
        resolve(partialMatch);
        return;
      }

      console.log(`Invalid selection. Using default: ${request.defaultOption || request.options[0]}`);
      resolve(request.defaultOption || request.options[0]);
    });
  }

  private clearLines(count: number): void {
    for (let i = 0; i < count; i++) {
      process.stdout.write('\x1b[1A');
      process.stdout.write('\x1b[2K');
      process.stdout.write('\r');
      process.stdout.write('\x1b[1B');
    }
    process.stdout.write('\r');
    process.stdout.write('\x1b[2J');
  }

  close(): void {
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
  }
}

export function createDecisionUI(config?: Partial<DecisionUIConfig>): DecisionUI {
  return new DecisionUI(config);
}