export type TaskCategory =
  | 'code'
  | 'multi_file'
  | 'json'
  | 'reasoning'
  | 'simple'
  | 'refactor'
  | 'debug'
  | 'test'
  | 'documentation';

export interface TaskClassification {
  primaryCategory: TaskCategory;
  secondaryCategory?: TaskCategory;
  confidence: number;
  complexity: 'trivial' | 'simple' | 'moderate' | 'complex' | 'very_complex';
  estimatedFiles: number;
  estimatedTokens: number;
  signals: string[];
}

export class TaskClassifier {

  classify(instruction: string): TaskClassification {
    const lower = instruction.toLowerCase();
    const signals: string[] = [];

    const multiFileSignals = this.detectMultiFile(lower);
    if (multiFileSignals.detected) {
      signals.push(...multiFileSignals.signals);
      return {
        primaryCategory: 'multi_file',
        secondaryCategory: 'code',
        confidence: multiFileSignals.confidence,
        complexity: this.estimateComplexity(instruction, 'multi_file'),
        estimatedFiles: multiFileSignals.estimatedFiles,
        estimatedTokens: multiFileSignals.estimatedFiles * 1500,
        signals
      };
    }

    const categoryScores = new Map<TaskCategory, number>();

    let codeScore = 0;
    if (/\b(create|write|build|implement|make|generate)\b.*\b(function|class|module|script|program|app|application|api|server|endpoint)\b/.test(lower)) {
      codeScore += 3;
      signals.push('CODE: create/build + code entity');
    }
    if (/\b(python|javascript|typescript|java|go|rust|ruby|php|c\+\+|swift|kotlin)\b/.test(lower)) {
      codeScore += 2;
      signals.push('CODE: programming language mentioned');
    }
    if (/\b(def |function |class |import |const |let |var |return |if |for |while )\b/.test(lower)) {
      codeScore += 2;
      signals.push('CODE: code keywords detected');
    }
    if (/\.(py|js|ts|jsx|tsx|java|go|rs|rb|php|cpp|c|h|swift|kt)\b/.test(lower)) {
      codeScore += 2;
      signals.push('CODE: file extension mentioned');
    }
    categoryScores.set('code', codeScore);

    let jsonScore = 0;
    if (/\b(json|yaml|yml|toml|xml|config|configuration|settings|schema)\b/.test(lower)) {
      jsonScore += 3;
      signals.push('JSON: config/structured format mentioned');
    }
    if (/\b(generate|create|output)\b.*\b(json|data|config)\b/.test(lower)) {
      jsonScore += 2;
      signals.push('JSON: generate structured data');
    }
    categoryScores.set('json', jsonScore);

    let reasoningScore = 0;
    if (/\b(explain|analyze|compare|evaluate|describe|why|how does|what is)\b/.test(lower)) {
      reasoningScore += 3;
      signals.push('REASONING: analysis/explanation keywords');
    }
    if (/\b(pros and cons|trade.?offs?|advantages|disadvantages|differences?)\b/.test(lower)) {
      reasoningScore += 2;
      signals.push('REASONING: comparison language');
    }
    categoryScores.set('reasoning', reasoningScore);

    let refactorScore = 0;
    if (/\b(refactor|improve|optimize|clean.?up|restructure|simplify|modernize)\b/.test(lower)) {
      refactorScore += 3;
      signals.push('REFACTOR: refactoring keywords');
    }
    if (/\b(existing|current|this|the) (code|function|class|module)\b/.test(lower)) {
      refactorScore += 1;
      signals.push('REFACTOR: references existing code');
    }
    categoryScores.set('refactor', refactorScore);

    let debugScore = 0;
    if (/\b(fix|debug|bug|error|issue|broken|not working|fails?|crash)\b/.test(lower)) {
      debugScore += 3;
      signals.push('DEBUG: debugging keywords');
    }
    categoryScores.set('debug', debugScore);

    let testScore = 0;
    if (/\b(test|spec|unit test|integration test|e2e|testing|jest|mocha|pytest)\b/.test(lower)) {
      testScore += 3;
      signals.push('TEST: testing keywords');
    }
    if (/\b(write tests?|create tests?|add tests?|test coverage)\b/.test(lower)) {
      testScore += 2;
      signals.push('TEST: test generation request');
    }
    categoryScores.set('test', testScore);

    let docScore = 0;
    if (/\b(readme|documentation|docs|comment|jsdoc|docstring|api docs)\b/.test(lower)) {
      docScore += 3;
      signals.push('DOC: documentation keywords');
    }
    categoryScores.set('documentation', docScore);

    let bestCategory: TaskCategory = 'simple';
    let bestScore = 0;
    let secondCategory: TaskCategory | undefined;
    let secondScore = 0;

    for (const [category, score] of categoryScores) {
      if (score > bestScore) {
        secondCategory = bestCategory;
        secondScore = bestScore;
        bestCategory = category;
        bestScore = score;
      } else if (score > secondScore) {
        secondCategory = category;
        secondScore = score;
      }
    }

    if (bestScore <= 1) {
      bestCategory = 'simple';
      signals.push('SIMPLE: no strong signals detected');
    }

    const confidence = bestScore === 0 ? 0.3 :
                       bestScore <= 2 ? 0.5 :
                       bestScore <= 4 ? 0.7 :
                       bestScore - secondScore >= 2 ? 0.9 : 0.75;

    return {
      primaryCategory: bestCategory,
      secondaryCategory: secondScore >= 2 ? secondCategory : undefined,
      confidence,
      complexity: this.estimateComplexity(instruction, bestCategory),
      estimatedFiles: bestCategory === 'simple' ? 1 :
                     bestCategory === 'code' ? 1 :
                     bestCategory === 'test' ? 2 :
                     bestCategory === 'documentation' ? 1 : 1,
      estimatedTokens: this.estimateTokens(instruction, bestCategory),
      signals
    };
  }

  private detectMultiFile(lower: string): {
    detected: boolean;
    confidence: number;
    estimatedFiles: number;
    signals: string[];
  } {
    const signals: string[] = [];
    let fileCount = 0;

    const fileExtensions = lower.match(/\b[\w-]+\.(py|js|ts|jsx|tsx|html|css|scss|java|go|rs|rb|php|yaml|yml|json|md|sql|sh)\b/g);
    if (fileExtensions && fileExtensions.length >= 2) {
      fileCount = Math.max(fileCount, fileExtensions.length);
      signals.push('MULTI_FILE: ' + fileExtensions.length + ' file extensions found: ' +
                   fileExtensions.join(', '));
    }

    const numbered = lower.match(/\b\d+\.\s+(create|build|add|make|write)\b/g);
    if (numbered && numbered.length >= 2) {
      fileCount = Math.max(fileCount, numbered.length);
      signals.push('MULTI_FILE: ' + numbered.length + ' numbered creation steps');
    }

    const multiComponents = [
      /\b(frontend|client)\b.*\b(backend|server)\b/,
      /\b(html|template)\b.*\b(css|style)\b.*\b(js|javascript|script)\b/,
      /\b(model|view|controller)\b.*\b(model|view|controller)\b/,
      /\b(component|page|layout)\b.*\b(component|page|layout)\b/,
    ];
    for (const pattern of multiComponents) {
      if (pattern.test(lower)) {
        fileCount = Math.max(fileCount, 3);
        signals.push('MULTI_FILE: multiple component pattern detected');
        break;
      }
    }

    if (/\b(project|full.?stack|web.?app|application|website|monorepo)\b/.test(lower)) {
      if (/\b(with|including|containing)\b/.test(lower)) {
        fileCount = Math.max(fileCount, 3);
        signals.push('MULTI_FILE: project-level creation language');
      }
    }

    return {
      detected: fileCount >= 2,
      confidence: fileCount >= 4 ? 0.95 : fileCount >= 3 ? 0.85 : fileCount >= 2 ? 0.7 : 0,
      estimatedFiles: fileCount,
      signals
    };
  }

  private estimateComplexity(
    instruction: string,
    _category: TaskCategory
  ): 'trivial' | 'simple' | 'moderate' | 'complex' | 'very_complex' {
    const words = instruction.split(/\s+/).length;

    if (words <= 10) return 'trivial';
    if (words <= 25) return 'simple';
    if (words <= 60) return 'moderate';
    if (words <= 120) return 'complex';
    return 'very_complex';
  }

  private estimateTokens(instruction: string, category: TaskCategory): number {
    const baseTokens: Record<TaskCategory, number> = {
      simple: 200,
      code: 800,
      multi_file: 2000,
      json: 500,
      reasoning: 1000,
      refactor: 600,
      debug: 600,
      test: 1000,
      documentation: 800
    };

    const words = instruction.split(/\s+/).length;
    const complexityMultiplier = words > 50 ? 2.0 : words > 25 ? 1.5 : 1.0;

    return Math.round(baseTokens[category] * complexityMultiplier);
  }
}

let globalTaskClassifier: TaskClassifier | null = null;

export function getTaskClassifier(): TaskClassifier {
  if (!globalTaskClassifier) {
    globalTaskClassifier = new TaskClassifier();
  }
  return globalTaskClassifier;
}
